import { describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MS,
  buildKiteQuery,
  buildShoreQuery,
  CACHE_TTL_MS,
  DEFAULT_OSM_NAME,
  ENDPOINTS,
  FAILURE_TTL_MS,
  fetchKiteSpots,
  MAX_CALLS_PER_DAY,
  parseKiteSpots,
  parseShoreFeatures,
  tileFor,
  type KV,
} from '../src/lib/overpass';
import { augmentWithOsm } from '../src/app/osm';
import type { Spot } from '../src/lib/types';

function memStore(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const T0 = Date.UTC(2025, 5, 1, 12);
const TARIFA = { lat: 36.01, lon: -5.6 };

describe('queries', () => {
  it('builds the kite query', () => {
    const q = buildKiteQuery({ lat: 36.0123456, lon: -5.6 }, 90_000);
    expect(q).toContain('[out:json][timeout:20];');
    expect(q).toContain('nwr["sport"~"kitesurfing"](around:90000,36.01235,-5.6)');
    expect(q).toContain('out tags center;');
  });
  it('builds one batched shore query', () => {
    const q = buildShoreQuery([
      { lat: 1, lon: 2 },
      { lat: 3, lon: 4 },
    ]);
    expect(q.match(/natural"="coastline"/g)).toHaveLength(2);
    expect(q).toContain('way["natural"="coastline"](around:1500,3,4);');
    expect(q).toContain('way["natural"="water"](around:1500,1,2);');
    expect(q.endsWith(');out geom;')).toBe(true);
  });
});

describe('tiles', () => {
  it('rounds to 0.5° and buckets the radius', () => {
    expect(tileFor({ lat: 36.2, lon: -5.6 }, 50).key).toBe('36.0,-5.5:r50');
    expect(tileFor({ lat: 36.3, lon: -5.8 }, 30).key).toBe('36.5,-6.0:r50');
    expect(tileFor({ lat: 36.3, lon: -5.8 }, 10).key).toBe('36.5,-6.0:r25');
    expect(tileFor({ lat: 36.3, lon: -5.8 }, 500).bucketKm).toBe(100);
    expect(tileFor({ lat: 36.3, lon: -5.8 }, 50).radiusM).toBe(90_000);
  });
});

describe('parseKiteSpots', () => {
  it('parses nodes, ways with centers, names and list-valued sport tags', () => {
    const spots = parseKiteSpots({
      elements: [
        { type: 'node', id: 1, lat: 36.01, lon: -5.6, tags: { sport: 'kitesurfing', name: 'Los Lances' } },
        { type: 'way', id: 2, center: { lat: 36.1, lon: -5.7 }, tags: { sport: 'windsurfing;kitesurfing' } },
        { type: 'relation', id: 3, center: { lat: 36.2, lon: -5.8 }, tags: { sport: 'kitesurfing', 'name:en': 'Valdevaqueros' } },
        { type: 'node', id: 4, lat: 1, lon: 1, tags: { sport: 'kitesurfing_school' } },
        { type: 'way', id: 5, tags: { sport: 'kitesurfing' } },
        { type: 'node', id: 1, lat: 36.01, lon: -5.6, tags: { sport: 'kitesurfing' } },
        { type: 'node', id: 6, lat: 2, lon: 2, tags: { sport: 'kitesurfing', name: '   ' } },
      ],
    });
    expect(spots).toEqual([
      { key: 'node-1', name: 'Los Lances', lat: 36.01, lon: -5.6 },
      { key: 'way-2', name: DEFAULT_OSM_NAME, lat: 36.1, lon: -5.7 },
      { key: 'relation-3', name: 'Valdevaqueros', lat: 36.2, lon: -5.8 },
      { key: 'node-6', name: DEFAULT_OSM_NAME, lat: 2, lon: 2 },
    ]);
    expect(DEFAULT_OSM_NAME).toBe('Kite spot (OSM)');
  });
  it('tolerates junk', () => {
    expect(parseKiteSpots(null)).toEqual([]);
    expect(parseKiteSpots({})).toEqual([]);
    expect(parseKiteSpots({ elements: 'x' })).toEqual([]);
    expect(parseKiteSpots({ elements: [null, 1, { type: 'node' }] })).toEqual([]);
  });
});

describe('parseShoreFeatures', () => {
  it('keeps coastline and water ways with geometry', () => {
    const f = parseShoreFeatures({
      elements: [
        { type: 'way', id: 1, tags: { natural: 'coastline' }, geometry: [{ lat: 0, lon: 0 }, null, { lat: 1, lon: 0 }] },
        { type: 'way', id: 2, tags: { natural: 'water' }, geometry: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }] },
        { type: 'way', id: 3, tags: { natural: 'wood' }, geometry: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }] },
        { type: 'way', id: 4, tags: { natural: 'coastline' }, geometry: [{ lat: 0, lon: 0 }] },
        { type: 'node', id: 5, lat: 0, lon: 0 },
      ],
    });
    expect(f).toEqual([
      { kind: 'coastline', points: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }] },
      { kind: 'water', points: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }] },
    ]);
  });
});

describe('fetchKiteSpots caching', () => {
  const body = { elements: [{ type: 'node', id: 1, lat: 36.01, lon: -5.6, tags: { sport: 'kitesurfing' } }] };

  it('fetches once per tile for 14 days', async () => {
    const storage = memStore();
    let now = T0;
    const fetch = vi.fn(async () => json(body));
    const deps = { fetch, storage, now: () => now };
    const a = await fetchKiteSpots(TARIFA, 50, deps);
    expect(a.spots).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINTS[0]);
    expect(init.method).toBe('POST');
    expect(String(init.body)).toMatch(/^data=%5Bout%3Ajson%5D/);
    // Same tile, nearby point, smaller radius (covered by the cached larger bucket).
    now += CACHE_TTL_MS - 1000;
    expect((await fetchKiteSpots({ lat: 36.1, lon: -5.5 }, 20, deps)).spots).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 2000;
    await fetchKiteSpots(TARIFA, 50, deps);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to the second endpoint on 429 and caches failures for an hour', async () => {
    const storage = memStore();
    let now = T0;
    const fetch = vi.fn(async (url: string) => (url === ENDPOINTS[0] ? json({}, 429) : json(body)));
    const deps = { fetch: fetch as unknown as typeof globalThis.fetch, storage, now: () => now };
    expect((await fetchKiteSpots(TARIFA, 50, deps)).spots).toHaveLength(1);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(ENDPOINTS);

    const failing = vi.fn(async () => json({}, 504));
    const d2 = { fetch: failing, storage: memStore(), now: () => now };
    expect((await fetchKiteSpots(TARIFA, 50, d2)).spots).toEqual([]);
    expect(failing).toHaveBeenCalledTimes(2);
    expect((await fetchKiteSpots(TARIFA, 50, d2)).spots).toEqual([]);
    expect(failing).toHaveBeenCalledTimes(2); // cached failure + backoff
    now += Math.max(FAILURE_TTL_MS, BACKOFF_MS) + 1;
    await fetchKiteSpots(TARIFA, 50, d2);
    expect(failing).toHaveBeenCalledTimes(4);
  });

  it('never throws on network errors', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('offline');
    });
    expect((await fetchKiteSpots(TARIFA, 50, { fetch, storage: memStore(), now: () => T0 })).spots).toEqual([]);
  });

  it('caps calls per device per day', async () => {
    const storage = memStore();
    let now = T0;
    const fetch = vi.fn(async () => json({ elements: [] }));
    const deps = { fetch, storage, now: () => now };
    for (let i = 0; i < MAX_CALLS_PER_DAY + 3; i++) await fetchKiteSpots({ lat: 10 + i, lon: 10 }, 50, deps);
    expect(fetch).toHaveBeenCalledTimes(MAX_CALLS_PER_DAY);
    now += 24 * 3600_000;
    await fetchKiteSpots({ lat: 50, lon: 10 }, 50, deps);
    expect(fetch).toHaveBeenCalledTimes(MAX_CALLS_PER_DAY + 1);
  });
});

describe('augmentWithOsm', () => {
  const spotAt = (lat: number, lon: number) => ({ lat, lon });
  // A north-south coastline 300 m east of the OSM spot at 36.2,-5.8 (water east).
  const dLon = 300 / (111_320 * Math.cos((36.2 * Math.PI) / 180));
  const kite = {
    elements: [
      { type: 'node', id: 10, lat: 36.01, lon: -5.6, tags: { sport: 'kitesurfing', name: 'Dup of curated' } },
      { type: 'node', id: 11, lat: 36.2, lon: -5.8, tags: { sport: 'kitesurfing', name: 'Coast spot' } },
      { type: 'way', id: 12, center: { lat: 36.4, lon: -5.3 }, tags: { sport: 'kitesurfing' } },
    ],
  };
  const shore = {
    elements: [{ type: 'way', id: 99, tags: { natural: 'coastline' }, geometry: [spotAt(36.15, -5.8 + dLon), spotAt(36.25, -5.8 + dLon)] }],
  };
  const curated: Spot[] = [{ id: 'tarifa', name: 'Tarifa', lat: 36.012, lon: -5.601, sectors: [[60, 120]] }];

  it('returns deduped OSM spots with coastline sectors and caches both queries', async () => {
    const storage = memStore();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => json(String(init?.body).includes('coastline') ? shore : kite));
    const deps = { fetch: fetch as unknown as typeof globalThis.fetch, storage, now: () => T0 };
    const spots = await augmentWithOsm(TARIFA, 50, curated, deps);
    expect(spots.map((s) => s.id)).toEqual(['osm-node-11', 'osm-way-12']);
    const coastSpot = spots[0];
    expect(coastSpot).toMatchObject({ name: 'Coast spot', source: 'osm', sectorSource: 'coastline', sectors: [[350, 190]] });
    expect(spots[1]).toMatchObject({ name: 'Kite spot (OSM)', source: 'osm', sectorSource: 'unknown' });
    expect(spots[1].sectors).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    const again = await augmentWithOsm(TARIFA, 50, curated, deps);
    expect(again).toEqual(spots);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('handles empty responses (e2e mocks) and failures without throwing', async () => {
    const empty = vi.fn(async () => json({ elements: [] }));
    expect(await augmentWithOsm(TARIFA, 50, curated, { fetch: empty, storage: memStore(), now: () => T0 })).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);
    const broken = vi.fn(async () => new Response('<html>', { status: 200 }));
    expect(await augmentWithOsm(TARIFA, 50, curated, { fetch: broken, storage: memStore(), now: () => T0 })).toEqual([]);
  });

  it('keeps spots with unknown sectors when the coastline query fails', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => (String(init?.body).includes('coastline') ? json({}, 504) : json(kite)));
    const spots = await augmentWithOsm(TARIFA, 50, curated, { fetch: fetch as unknown as typeof globalThis.fetch, storage: memStore(), now: () => T0 });
    expect(spots.map((s) => s.sectorSource)).toEqual(['unknown', 'unknown']);
  });
});
