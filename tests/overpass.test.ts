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
  MAX_SHORE_BBOX_KM,
  MAX_SHORE_POINTS,
  paddedBBox,
  parseKiteSpots,
  planShoreQuery,
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
  it('builds one bbox shore query for coastline, lakes and multipolygons', () => {
    const q = buildShoreQuery({ south: 1, west: 2, north: 3.123456, east: 4 });
    expect(q).not.toContain('around');
    expect(q.match(/\(1,2,3\.12346,4\)/g)).toHaveLength(5);
    expect(q).toContain('way["natural"="coastline"](1,2,3.12346,4);');
    expect(q).toContain('way["natural"="water"][!"water"](1,2,3.12346,4);');
    expect(q).toContain('relation["natural"="water"]["type"="multipolygon"]["water"~"^(lake|reservoir|lagoon|river)$"](1,2,3.12346,4);');
    expect(q.endsWith(');out geom;')).toBe(true);
  });
});

describe('planShoreQuery', () => {
  const kmLat = (km: number) => km / 111.32;
  it('pads every spot by ~2 km when the box fits', () => {
    const pts = [
      { lat: 36, lon: -5.6 },
      { lat: 36 + kmLat(10), lon: -5.6 },
    ];
    const plan = planShoreQuery(pts)!;
    expect(plan.covered).toEqual(pts);
    expect(plan.bbox.south).toBeCloseTo(36 - kmLat(2), 6);
    expect(plan.bbox.north).toBeCloseTo(36 + kmLat(12), 6);
    expect(planShoreQuery([])).toBeNull();
  });

  it('falls back to the nearest spots when the tile box is too large', () => {
    // Nearest first: a tight cluster, then one spot 100 km north.
    const near = Array.from({ length: 3 }, (_, i) => ({ lat: 36 + kmLat(i), lon: -5.6 }));
    const far = { lat: 36 + kmLat(100), lon: -5.6 };
    const plan = planShoreQuery([...near, far])!;
    expect(plan.covered).toEqual(near);
    expect(plan.bbox.north).toBeLessThan(far.lat);
    expect((plan.bbox.north - plan.bbox.south) * 111.32).toBeLessThanOrEqual(MAX_SHORE_BBOX_KM);
  });

  it('caps the fallback at MAX_SHORE_POINTS and shrinks until it fits', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ lat: 36 + kmLat(i * 0.5), lon: -5.6 }));
    const plan = planShoreQuery([...many, { lat: 40, lon: -5.6 }])!;
    expect(plan.covered).toHaveLength(MAX_SHORE_POINTS);
    const spread = Array.from({ length: 5 }, (_, i) => ({ lat: 36 + kmLat(i * 20), lon: -5.6 }));
    const p2 = planShoreQuery(spread)!;
    expect(p2.covered).toEqual(spread.slice(0, 2));
    expect(p2.bbox).toEqual(paddedBBox(spread.slice(0, 2)));
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
        { type: 'way', id: 6, tags: { natural: 'water', water: 'river' }, geometry: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }] },
      ],
    });
    expect(f).toEqual([
      { kind: 'coastline', points: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }] },
      { kind: 'water', points: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }] },
      { kind: 'river', points: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }] },
    ]);
  });

  it('assembles multipolygon outer rings and ignores inner rings', () => {
    const p = (lat: number, lon: number) => ({ lat, lon });
    const f = parseShoreFeatures({
      elements: [
        {
          type: 'relation',
          id: 7,
          tags: { natural: 'water', water: 'lake', type: 'multipolygon' },
          members: [
            { type: 'way', ref: 1, role: 'outer', geometry: [p(0, 0), p(0, 1), p(1, 1)] },
            // Reversed fragment closing the ring.
            { type: 'way', ref: 2, role: 'outer', geometry: [p(0, 0), p(1, 0), p(1, 1)] },
            { type: 'way', ref: 3, role: 'inner', geometry: [p(0.4, 0.4), p(0.4, 0.6), p(0.6, 0.6), p(0.4, 0.4)] },
            // Never closes: dropped.
            { type: 'way', ref: 4, role: 'outer', geometry: [p(5, 5), p(5, 6)] },
          ],
        },
      ],
    });
    expect(f).toEqual([{ kind: 'water', points: [p(0, 0), p(0, 1), p(1, 1), p(1, 0), p(0, 0)] }]);
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
    // One bbox query around the nearest spot only: way-12 is ~45 km away (box too large).
    const shoreQuery = decodeURIComponent(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(shoreQuery).not.toContain('around');
    const m = /way\["natural"="coastline"\]\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(shoreQuery)!;
    const [south, west, north, east] = m.slice(1).map(Number);
    expect(south < 36.2 && north > 36.2 && west < -5.8 && east > -5.8).toBe(true);
    expect(north).toBeLessThan(36.4);
    const again = await augmentWithOsm(TARIFA, 50, curated, deps);
    expect(again).toEqual(spots);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('infers a lake spot from a multipolygon and leaves a river spot unknown', async () => {
    const at = (lat: number, lon: number, northM: number, eastM: number) => ({
      lat: lat + northM / 111_320,
      lon: lon + eastM / (111_320 * Math.cos((lat * Math.PI) / 180)),
    });
    const lake = { lat: 36.1, lon: -5.7 };
    const riv = { lat: 36.1, lon: -5.65 };
    const kiteBody = {
      elements: [
        { type: 'node', id: 21, ...lake, tags: { sport: 'kitesurfing' } },
        { type: 'node', id: 22, ...riv, tags: { sport: 'kitesurfing' } },
      ],
    };
    // 2 km x 2 km lake whose west shore is 300 m east of the lake spot, split into two outer ways.
    const a = at(lake.lat, lake.lon, -1000, 300);
    const b = at(lake.lat, lake.lon, -1000, 2300);
    const c = at(lake.lat, lake.lon, 1000, 2300);
    const d = at(lake.lat, lake.lon, 1000, 300);
    const shoreBody = {
      elements: [
        {
          type: 'relation',
          id: 1,
          tags: { natural: 'water', type: 'multipolygon' },
          members: [
            { type: 'way', role: 'outer', geometry: [a, b, c] },
            { type: 'way', role: 'outer', geometry: [a, d, c] },
          ],
        },
        // A river polygon 100 m north of the river spot (with a coastline farther away).
        { type: 'way', id: 2, tags: { natural: 'water', water: 'river' }, geometry: [at(riv.lat, riv.lon, 100, -3000), at(riv.lat, riv.lon, 100, 3000)] },
        { type: 'way', id: 3, tags: { natural: 'coastline' }, geometry: [at(riv.lat, riv.lon, -800, -3000), at(riv.lat, riv.lon, -800, 3000)] },
      ],
    };
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => json(String(init?.body).includes('coastline') ? shoreBody : kiteBody));
    const spots = await augmentWithOsm(TARIFA, 50, [], { fetch: fetch as unknown as typeof globalThis.fetch, storage: memStore(), now: () => T0 });
    const byId = Object.fromEntries(spots.map((s) => [s.id, s]));
    expect(byId['osm-node-21']).toMatchObject({ sectorSource: 'coastline', sectors: [[350, 190]] });
    expect(byId['osm-node-22']).toMatchObject({ sectorSource: 'unknown' });
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
