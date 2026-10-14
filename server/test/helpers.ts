import { b64urlEncode, bytes, type Bytes } from '../src/b64';
import type { KV, KVListResult, Env } from '../src/env';
import { deriveKeys, type PushSubscriptionJSON } from '../src/webpush';

export class MemoryKV implements KV {
  map = new Map<string, string>();
  writes = 0;
  async get(key: string, _type: 'json'): Promise<unknown> {
    const v = this.map.get(key);
    return v === undefined ? null : JSON.parse(v);
  }
  async put(key: string, value: string): Promise<void> {
    this.writes++;
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(opts: { prefix?: string; cursor?: string; limit?: number } = {}): Promise<KVListResult> {
    const all = [...this.map.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 2; // tiny page size exercises pagination
    const keys = all.slice(start, start + limit).map((name) => ({ name }));
    const done = start + limit >= all.length;
    return { keys, list_complete: done, cursor: done ? undefined : String(start + limit) };
  }
}

export interface Receiver {
  sub: PushSubscriptionJSON;
  privateKey: CryptoKey;
  publicRaw: Bytes;
  auth: Bytes;
}

export async function makeReceiver(endpoint = 'https://push.example.com/send/abc'): Promise<Receiver> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(bytes(16));
  return { sub: { endpoint, keys: { p256dh: b64urlEncode(publicRaw), auth: b64urlEncode(auth) } }, privateKey: kp.privateKey, publicRaw, auth };
}

/** Receiver-side RFC 8291 decryption (independent of the sender code path except key derivation). */
export async function decrypt(body: Uint8Array, r: { privateKey: CryptoKey; publicRaw: Bytes; auth: Bytes }): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  if (rs < 18 || ct.length > rs) throw new Error('bad record size');
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, r.privateKey, 256));
  const { cek, nonce } = await deriveKeys(secret, r.auth, r.publicRaw, asPublic, salt);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  let end = pt.length - 1;
  while (end >= 0 && pt[end] === 0) end--;
  if (pt[end] !== 2) throw new Error('missing last-record delimiter');
  return new TextDecoder().decode(pt.slice(0, end));
}

export async function makeVapid(): Promise<{ publicKey: string; privateKey: string; subject: string; verifyKey: CryptoKey }> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicKey = b64urlEncode(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey, privateKey: jwk.d!, subject: 'mailto:test@example.com', verifyKey: kp.publicKey };
}

export async function makeEnv(extra: Partial<Omit<Env, 'SUBS'>> = {}): Promise<Env & { SUBS: MemoryKV }> {
  const v = await makeVapid();
  return { VAPID_PUBLIC_KEY: v.publicKey, VAPID_PRIVATE_KEY: v.privateKey, VAPID_SUBJECT: v.subject, QUIET_HOURS: '', ...extra, SUBS: new MemoryKV() };
}
