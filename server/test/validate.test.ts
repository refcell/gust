import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/lib/types';
import { MAX_SPOTS, parseSubscribe, parseUnsubscribe } from '../src/validate';
import { makeReceiver } from './helpers';

async function validBody() {
  const r = await makeReceiver();
  return {
    subscription: { ...r.sub, expirationTime: null },
    settings: { ...DEFAULT_SETTINGS },
    location: { lat: 37.9, lon: -122.4 },
    spots: [{ id: 'crissy', name: 'Crissy Field', lat: 37.805, lon: -122.465, sectors: [[225, 300]] }],
    tz: 'America/Los_Angeles',
  };
}

describe('parseSubscribe', () => {
  it('accepts the client payload and normalizes it', async () => {
    const body = await validBody();
    const r = parseSubscribe(body, 123);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.subscription).toEqual({ endpoint: body.subscription.endpoint, keys: body.subscription.keys });
    expect(r.value.spots[0].sectors).toEqual([[225, 300]]);
    expect(r.value.updatedAt).toBe(123);
    expect(r.value.tz).toBe('America/Los_Angeles');
  });

  it('defaults missing settings, sectors, location and tz', async () => {
    const body = await validBody();
    const r = parseSubscribe({ subscription: body.subscription, spots: [{ id: 'a', name: 'A', lat: 1, lon: 2 }] });
    expect(r.ok && r.value.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.ok && r.value.spots[0].sectors).toEqual([]);
    expect(r.ok && r.value.location).toBeNull();
    expect(r.ok && r.value.tz).toBe('UTC');
  });

  it('drops duplicate spot ids and unknown fields', async () => {
    const body = await validBody();
    const s = { id: 'a', name: 'A', lat: 1, lon: 2, sectors: [], evil: 'x'.repeat(10) };
    const r = parseSubscribe({ ...body, spots: [s, s] });
    expect(r.ok && r.value.spots).toEqual([{ id: 'a', name: 'A', lat: 1, lon: 2, sectors: [] }]);
  });

  const bad: [string, (b: Awaited<ReturnType<typeof validBody>>) => unknown, RegExp][] = [
    ['non-object', () => 'nope', /object/],
    ['http endpoint', (b) => ({ ...b, subscription: { ...b.subscription, endpoint: 'http://x/y' } }), /https/],
    ['bad endpoint', (b) => ({ ...b, subscription: { ...b.subscription, endpoint: 'not a url' } }), /URL/],
    ['short p256dh', (b) => ({ ...b, subscription: { ...b.subscription, keys: { ...b.subscription.keys, p256dh: 'AAAA' } } }), /p256dh/],
    ['bad auth', (b) => ({ ...b, subscription: { ...b.subscription, keys: { ...b.subscription.keys, auth: '!!' } } }), /auth/],
    ['too many spots', (b) => ({ ...b, spots: Array.from({ length: MAX_SPOTS + 1 }, (_, i) => ({ id: `s${i}`, name: 'x', lat: 0, lon: 0 })) }), /at most/],
    ['lat out of range', (b) => ({ ...b, spots: [{ id: 'a', name: 'A', lat: 91, lon: 0 }] }), /lat\/lon/],
    ['NaN lon', (b) => ({ ...b, location: { lat: 0, lon: NaN } }), /location/],
    ['bad sector', (b) => ({ ...b, spots: [{ id: 'a', name: 'A', lat: 0, lon: 0, sectors: [[1, 2, 3]] }] }), /sectors/],
    ['maxKn < minKn', (b) => ({ ...b, settings: { ...b.settings, minKn: 20, maxKn: 10 } }), /maxKn/],
    ['bad unit', (b) => ({ ...b, settings: { ...b.settings, unit: 'furlongs' } }), /unit/],
    ['string number', (b) => ({ ...b, settings: { ...b.settings, minKn: '15' } }), /minKn/],
    ['bad tz', (b) => ({ ...b, tz: 'Mars/Olympus' }), /tz/],
    ['huge name', (b) => ({ ...b, spots: [{ id: 'a', name: 'x'.repeat(500), lat: 0, lon: 0 }] }), /name/],
  ];
  for (const [name, mk, re] of bad) {
    it(`rejects ${name}`, async () => {
      const r = parseSubscribe(mk(await validBody()));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(re);
    });
  }
});

describe('parseUnsubscribe', () => {
  it('requires an endpoint string', () => {
    expect(parseUnsubscribe({ endpoint: 'https://x' })).toEqual({ ok: true, value: { endpoint: 'https://x' } });
    expect(parseUnsubscribe({}).ok).toBe(false);
    expect(parseUnsubscribe(null).ok).toBe(false);
  });
});
