import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, utf8 } from '../src/b64';
import { encryptPayload, p256Jwk, sendPush, vapidAuthorization } from '../src/webpush';
import { decrypt, makeReceiver, makeVapid } from './helpers';

// RFC 8291 §5 / Appendix A example.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  message:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

describe('RFC 8291 payload encryption', () => {
  it('matches the RFC 8291 test vector', async () => {
    const asPublicRaw = b64urlDecode(RFC.asPublic);
    const privateKey = await crypto.subtle.importKey('jwk', p256Jwk(asPublicRaw, RFC.asPrivate), ECDH, false, ['deriveBits']);
    const body = await encryptPayload(
      { endpoint: 'https://push.example.net/x', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } },
      utf8(RFC.plaintext),
      { salt: b64urlDecode(RFC.salt), senderKeys: { privateKey, publicRaw: asPublicRaw } },
    );
    expect(b64urlEncode(body)).toBe(RFC.message);
  });

  it('decrypts the RFC 8291 message with the receiver key', async () => {
    const uaPublicRaw = b64urlDecode(RFC.uaPublic);
    const privateKey = await crypto.subtle.importKey('jwk', p256Jwk(uaPublicRaw, RFC.uaPrivate), ECDH, false, ['deriveBits']);
    const pt = await decrypt(b64urlDecode(RFC.message), { privateKey, publicRaw: uaPublicRaw, auth: b64urlDecode(RFC.auth) });
    expect(pt).toBe(RFC.plaintext);
  });

  it('round-trips with a freshly generated receiver key', async () => {
    const r = await makeReceiver();
    const payload = JSON.stringify({ title: 'Waddell is on', body: '22 kn gusting 28 from WNW', tag: 'now-x', url: 'https://x/' });
    const body = await encryptPayload(r.sub, utf8(payload));
    expect(body.length).toBe(16 + 4 + 1 + 65 + utf8(payload).length + 1 + 16);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(await decrypt(body, r)).toBe(payload);
    // Fresh salt and ephemeral key each time.
    const again = await encryptPayload(r.sub, utf8(payload));
    expect(b64urlEncode(again)).not.toBe(b64urlEncode(body));
  });

  it('fails to decrypt with the wrong auth secret', async () => {
    const r = await makeReceiver();
    const body = await encryptPayload(r.sub, utf8('hello'));
    await expect(decrypt(body, { ...r, auth: new Uint8Array(16) })).rejects.toThrow();
  });

  it('rejects invalid subscription keys and oversized payloads', async () => {
    const r = await makeReceiver();
    await expect(encryptPayload({ ...r.sub, keys: { ...r.sub.keys, auth: 'AAAA' } }, utf8('x'))).rejects.toThrow(/auth/);
    await expect(encryptPayload(r.sub, utf8('x'.repeat(5000)))).rejects.toThrow(/too large/);
  });
});

describe('VAPID', () => {
  it('builds a verifiable ES256 JWT for the push service origin', async () => {
    const v = await makeVapid();
    const now = 1_700_000_000;
    const auth = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', v, now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth);
    expect(m).not.toBeNull();
    const [, h, c, s, k] = m!;
    expect(k).toBe(v.publicKey);
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: now + 12 * 3600, sub: v.subject });
    const sig = b64urlDecode(s);
    expect(sig.length).toBe(64);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.verifyKey, sig, utf8(`${h}.${c}`));
    expect(ok).toBe(true);
    // Public key from the header verifies too.
    const k2 = await crypto.subtle.importKey('raw', b64urlDecode(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k2, sig, utf8(`${h}.${c}`))).toBe(true);
  });

  it('accepts a JWK private key', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const publicKey = b64urlEncode(await crypto.subtle.exportKey('raw', kp.publicKey));
    const auth = await vapidAuthorization('https://web.push.apple.com/x', { publicKey, privateKey: JSON.stringify(jwk), subject: 'mailto:a@b.c' });
    expect(auth).toMatch(/^vapid t=.+, k=/);
  });

  it('sendPush posts an encrypted body with the Web Push headers', async () => {
    const r = await makeReceiver();
    const v = await makeVapid();
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const res = await sendPush(r.sub, '{"title":"t"}', v, { ttl: 60, urgency: 'high', fetchImpl });
    expect(res.status).toBe(201);
    const h = seen!.init.headers as Record<string, string>;
    expect(seen!.url).toBe(r.sub.endpoint);
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.TTL).toBe('60');
    expect(h.Urgency).toBe('high');
    expect(h.Authorization).toMatch(/^vapid t=/);
    expect(await decrypt(seen!.init.body as Uint8Array, r)).toBe('{"title":"t"}');
  });
});
