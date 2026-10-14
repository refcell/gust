import { marineUrl, parseMarine, type MarineData } from '../lib/marine';

/** Marine forecasts change slowly: reuse a spot's result for an hour (in memory; the SW caches too). */
export const MARINE_TTL_MS = 60 * 60_000;

const cache = new Map<string, { at: number; data: MarineData | null }>();
const inflight = new Map<string, Promise<MarineData | null>>();

/**
 * Marine data for one point, cached per key for an hour. Resolves null when there is no marine
 * data (inland) — also cached. Network errors reject and are not cached.
 */
export function loadMarine(key: string, lat: number, lon: number, now = Date.now()): Promise<MarineData | null> {
  const hit = cache.get(key);
  if (hit && now - hit.at >= 0 && now - hit.at < MARINE_TTL_MS) return Promise.resolve(hit.data);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    try {
      const res = await fetch(marineUrl(lat, lon));
      // 4xx: the API has no marine grid here (treated like all-null data). 5xx/network: retry later.
      if (!res.ok && res.status >= 500) throw new Error(`marine ${res.status}`);
      const data = res.ok ? parseMarine(await res.json()) : null;
      cache.set(key, { at: Date.now(), data });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
