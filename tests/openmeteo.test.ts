import { describe, expect, it, vi } from 'vitest';
import { BATCH, fetchSpotWind, fetchWind, fetchWindBatches, splitFresh } from '../src/lib/openmeteo';
import type { SpotWind } from '../src/lib/types';

// Mocked fetch only: no network.
const hourlyTimes = ['2025-06-01T12:00', '2025-06-01T13:00'];
const loc = () => ({
  utc_offset_seconds: 0,
  current: { time: '2025-06-01T12:00', wind_speed_10m: 18, wind_gusts_10m: 22, wind_direction_10m: 270 },
  hourly: { time: hourlyTimes, wind_speed_10m: [18, 19], wind_gusts_10m: [22, 23], wind_direction_10m: [270, 270] },
});
const ok = (n: number) => new Response(JSON.stringify(n === 1 ? loc() : Array.from({ length: n }, loc)), { status: 200 });
const latsOf = (url: string) => new URL(url).searchParams.get('latitude')!.split(',');
const spot = (i: number) => ({ id: `s${i}`, lat: i / 100, lon: 1 });

describe('fetchWindBatches', () => {
  it('aborts a stalled request at the deadline and reports it as failed', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined); // never settles
    });
    const t0 = Date.now();
    const r = await fetchWindBatches([spot(1), spot(2)], { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 30 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(signal?.aborted).toBe(true);
    expect(r).toEqual({ winds: [null, null], failed: [0, 1] });
  });

  it('reports the spots of a failed batch while keeping the successful batch', async () => {
    const spots = Array.from({ length: BATCH + 3 }, (_, i) => spot(i));
    let call = 0;
    const fetchImpl = vi.fn(async (u: RequestInfo | URL) => (call++ === 0 ? ok(latsOf(String(u)).length) : new Response('busy', { status: 429 })));
    const r = await fetchSpotWind(spots, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(Object.keys(r.wind)).toHaveLength(BATCH);
    expect(r.failedIds).toEqual(['s50', 's51', 's52']);
    // The array API still aligns with the input and nulls failures.
    call = 0;
    const arr = await fetchWind(spots, fetchImpl as unknown as typeof fetch);
    expect(arr.filter(Boolean)).toHaveLength(BATCH);
    expect(arr.slice(BATCH)).toEqual([null, null, null]);
  });

  it('treats a network error and a short response as failures', async () => {
    const broken = vi.fn(async () => {
      throw new TypeError('network');
    });
    expect((await fetchSpotWind([spot(1)], { fetchImpl: broken as unknown as typeof fetch })).failedIds).toEqual(['s1']);
    const short = vi.fn(async () => ok(1)); // one location for two points
    const r = await fetchSpotWind([spot(1), spot(2)], { fetchImpl: short as unknown as typeof fetch });
    expect(Object.keys(r.wind)).toEqual(['s1']);
    expect(r.failedIds).toEqual(['s2']);
  });

  it('a retry fetches only the failed spots (fresh successful samples are reused)', async () => {
    const spots = [spot(1), spot(2), spot(3)];
    const fail = new Set(['0.0200']);
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: RequestInfo | URL) => {
      urls.push(String(u));
      const lats = latsOf(String(u));
      if (lats.some((l) => fail.has(l))) throw new TypeError('network');
      return ok(lats.length);
    });
    const f = fetchImpl as unknown as typeof fetch;
    // First refresh: per-spot requests, the one for s2 fails.
    const first = await Promise.all(spots.map((s) => fetchSpotWind([s], { fetchImpl: f })));
    const wind: Record<string, SpotWind> = Object.assign({}, ...first.map((r) => r.wind));
    const failedIds = first.flatMap((r) => r.failedIds);
    expect(failedIds).toEqual(['s2']);

    // Minute retry: everything else is fresh, so only s2 is fetched.
    fail.clear();
    urls.length = 0;
    const { missing } = splitFresh(spots, wind, Date.now(), undefined, failedIds);
    expect(missing.map((s) => s.id)).toEqual(['s2']);
    const retry = await fetchSpotWind(missing, { fetchImpl: f });
    expect(urls).toHaveLength(1);
    expect(latsOf(urls[0])).toEqual(['0.0200']);
    expect(Object.keys(retry.wind)).toEqual(['s2']);
    expect(retry.failedIds).toEqual([]);
  });

  it('splitFresh refetches failed spots even when their previous sample is fresh', () => {
    const now = 1_000_000;
    const w = { a: { fetchedAt: now - 1000 } as SpotWind, b: { fetchedAt: now - 1000 } as SpotWind };
    const r = splitFresh([{ id: 'a' }, { id: 'b' }], w, now, undefined, ['b']);
    expect(Object.keys(r.fresh)).toEqual(['a']);
    expect(r.missing.map((s) => s.id)).toEqual(['b']);
  });
});

describe('invalid samples', () => {
  it('reports an unparseable location as failed so it is retried', async () => {
    const bad = { utc_offset_seconds: 0, current: {}, hourly: {} };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([loc(), bad]), { status: 200 }));
    const r = await fetchSpotWind([spot(1), spot(2)], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(Object.keys(r.wind)).toEqual(['s1']);
    expect(r.failedIds).toEqual(['s2']);
  });
});
