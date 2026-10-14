/**
 * Minimal Web Push sender on WebCrypto only (runs in Cloudflare Workers, Deno, Node >= 20).
 *
 * - Payload encryption: RFC 8291 (Message Encryption for Web Push) using the RFC 8188
 *   `aes128gcm` content coding, single record.
 * - Sender identification: RFC 8292 VAPID with an ES256 JWT.
 */
import { b64urlDecode, b64urlEncode, bytes, concat, utf8, type Bytes } from './b64';

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** Uncompressed P-256 public key (65 bytes), base64url. */
  publicKey: string;
  /** Private key: base64url `d` (32 bytes) or a JSON-encoded JWK. */
  privateKey: string;
  /** `mailto:` or `https:` contact. */
  subject: string;
}

const RECORD_SIZE = 4096;
const ECDH: EcKeyImportParams = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA: EcKeyImportParams = { name: 'ECDSA', namedCurve: 'P-256' };

/** JWK for a P-256 key from its raw uncompressed public point and optional private scalar. */
export function p256Jwk(publicRaw: Uint8Array, d?: string): JsonWebKey {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error('expected 65-byte uncompressed P-256 public key');
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: b64urlEncode(publicRaw.slice(1, 33)), y: b64urlEncode(publicRaw.slice(33, 65)), ext: true };
  if (d) jwk.d = d;
  return jwk;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** Derive the content-encryption key and nonce shared by sender and receiver (RFC 8291 §3.4). */
export async function deriveKeys(ecdhSecret: Bytes, authSecret: Bytes, uaPublic: Bytes, asPublic: Bytes, salt: Bytes): Promise<{ cek: Bytes; nonce: Bytes }> {
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  return { cek, nonce };
}

export interface EncryptOptions {
  /** Inject for deterministic tests; random otherwise. */
  salt?: Bytes;
  /** Inject for deterministic tests; generated otherwise. */
  senderKeys?: { privateKey: CryptoKey; publicRaw: Bytes };
}

/** Encrypt `plaintext` for a subscription. Returns the full aes128gcm body (header + single record). */
export async function encryptPayload(sub: PushSubscriptionJSON, plaintext: Bytes, opts: EncryptOptions = {}): Promise<Bytes> {
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('invalid p256dh');
  if (authSecret.length !== 16) throw new Error('invalid auth secret');
  // One record: plaintext + 0x02 delimiter + 16-byte tag must fit in rs.
  if (plaintext.length + 17 > RECORD_SIZE) throw new Error('payload too large');

  let sender = opts.senderKeys;
  if (!sender) {
    const kp = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
    sender = { privateKey: kp.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)) };
  }
  const salt = opts.salt ?? crypto.getRandomValues(bytes(16));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, ECDH, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));
  const { cek, nonce } = await deriveKeys(ecdhSecret, authSecret, uaPublic, sender.publicRaw, salt);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(plaintext, new Uint8Array([2])); // last-record delimiter, no padding
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));

  const header = bytes(16 + 4 + 1 + sender.publicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = sender.publicRaw.length;
  header.set(sender.publicRaw, 21);
  return concat(header, ct);
}

async function importVapidPrivate(keys: VapidKeys): Promise<CryptoKey> {
  const pk = keys.privateKey.trim();
  const jwk: JsonWebKey = pk.startsWith('{') ? (JSON.parse(pk) as JsonWebKey) : p256Jwk(b64urlDecode(keys.publicKey), pk);
  return crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, ECDSA, false, ['sign']);
}

/** Build the VAPID `Authorization` header value for an endpoint (RFC 8292). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSec = Math.floor(Date.now() / 1000), ttlSec = 12 * 3600): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(utf8(JSON.stringify({ aud, exp: nowSec + ttlSec, sub: keys.subject })));
  const input = `${header}.${claims}`;
  const key = await importVapidPrivate(keys);
  // WebCrypto ECDSA returns IEEE P1363 r||s, which is exactly the JWS ES256 signature format.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(input));
  return `vapid t=${input}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

export interface SendOptions {
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  topic?: string;
  fetchImpl?: typeof fetch;
}

/** Encrypt and POST a push message. Returns the push service response. */
export async function sendPush(sub: PushSubscriptionJSON, payload: string, keys: VapidKeys, opts: SendOptions = {}): Promise<Response> {
  const body = await encryptPayload(sub, utf8(payload));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, keys),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 3600),
    Urgency: opts.urgency ?? 'normal',
  };
  if (opts.topic) headers.Topic = opts.topic;
  return (opts.fetchImpl ?? fetch)(sub.endpoint, { method: 'POST', headers, body });
}
