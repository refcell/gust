import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/lib/types';
import worker, { isAllowedOrigin } from '../src/index';
import { endpointId } from '../src/store';
import { makeEnv, makeReceiver } from './helpers';

const BASE = 'https://gust-push.example.workers.dev';
const ORIGIN = 'https://refcell.github.io';

function post(path: string, body: unknown, origin: string | null = ORIGIN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  return new Request(BASE + path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

describe('origins', () => {
  it('allows the Pages origin, localhost and configured extras', () => {
    expect(isAllowedOrigin('https://refcell.github.io', {})).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', {})).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4173', {})).toBe(true);
    expect(isAllowedOrigin('http://localhost', {})).toBe(true);
    expect(isAllowedOrigin('https://evil.example', {})).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.example', {})).toBe(false);
    expect(isAllowedOrigin('https://refcell.github.io.evil.example', {})).toBe(false);
    expect(isAllowedOrigin('https://gust.example', { ALLOWED_ORIGINS: 'https://a.b, https://gust.example' })).toBe(true);
  });
});

describe('HTTP API', () => {
  it('subscribe -> health -> unsubscribe', async () => {
    const env = await makeEnv();
    const r = await makeReceiver();
    const body = {
      subscription: r.sub,
      settings: DEFAULT_SETTINGS,
      location: { lat: 1, lon: 2 },
      spots: [{ id: 'a', name: 'A', lat: 1, lon: 2, sectors: [[0, 90]] }],
      tz: 'UTC',
    };
    const res = await worker.fetch(post('/subscribe', body), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const id = await endpointId(r.sub.endpoint);
    expect(env.SUBS.map.has('sub:' + id)).toBe(true);

    // Upsert: same endpoint keeps one record.
    await worker.fetch(post('/subscribe', { ...body, spots: [] }), env);
    const h = await worker.fetch(new Request(BASE + '/health'), env);
    expect(await h.json()).toEqual({ ok: true, subscribers: 1 });

    const u = await worker.fetch(post('/unsubscribe', { endpoint: r.sub.endpoint }), env);
    expect(u.status).toBe(200);
    expect(env.SUBS.map.size).toBe(0);
  });

  it('serves the VAPID public key', async () => {
    const env = await makeEnv();
    const res = await worker.fetch(new Request(BASE + '/vapid', { headers: { origin: 'http://localhost:5173' } }), env);
    expect(await res.json()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('answers CORS preflight for allowed origins only', async () => {
    const env = await makeEnv();
    const ok = await worker.fetch(new Request(BASE + '/subscribe', { method: 'OPTIONS', headers: { origin: ORIGIN } }), env);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-methods')).toContain('POST');
    const no = await worker.fetch(new Request(BASE + '/subscribe', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env);
    expect(no.status).toBe(403);
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects POSTs from unknown origins, bad JSON, invalid bodies and oversized bodies', async () => {
    const env = await makeEnv();
    expect((await worker.fetch(post('/subscribe', {}, 'https://evil.example'), env)).status).toBe(403);
    expect((await worker.fetch(post('/subscribe', '{nope'), env)).status).toBe(400);
    const inv = await worker.fetch(post('/subscribe', { subscription: { endpoint: 'https://x' } }), env);
    expect(inv.status).toBe(400);
    expect(((await inv.json()) as { error: string }).error).toMatch(/keys/);
    expect((await worker.fetch(post('/subscribe', 'x'.repeat(70_000)), env)).status).toBe(413);
    expect((await worker.fetch(post('/unsubscribe', {}), env)).status).toBe(400);
    expect(env.SUBS.map.size).toBe(0);
  });

  it('404s unknown routes', async () => {
    const env = await makeEnv();
    expect((await worker.fetch(new Request(BASE + '/nope'), env)).status).toBe(404);
    expect((await worker.fetch(new Request(BASE + '/subscribe'), env)).status).toBe(404);
  });
});
