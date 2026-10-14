/** base64url helpers (no padding), Workers/Node/browser compatible. */

export type Bytes = Uint8Array<ArrayBuffer>;

export function bytes(n: number): Bytes {
  return new Uint8Array(new ArrayBuffer(n));
}

export function b64urlEncode(data: Uint8Array | ArrayBuffer): string {
  const u = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode base64url (or standard base64). Throws on invalid input. */
export function b64urlDecode(s: string): Bytes {
  if (!/^[A-Za-z0-9\-_+/]*={0,2}$/.test(s)) throw new Error('invalid base64');
  const clean = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const out = bytes(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = bytes(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const utf8 = (s: string): Bytes => {
  const e = new TextEncoder().encode(s);
  const out = bytes(e.length);
  out.set(e);
  return out;
};
