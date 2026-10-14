import type { LatLon } from './geo';
import type { ShoreFeature } from './coastline';

/**
 * OpenStreetMap Overpass client with strict caching.
 *
 * The public Overpass instances allow roughly 100 requests per day per IP, shared by every
 * user behind it, so this module:
 * - caches results per coarse tile (0.5° grid + radius bucket) for 14 days,
 * - caches failures for 1 hour,
 * - caps each device at MAX_CALLS_PER_DAY HTTP requests,
 * - backs off for an hour after rate limiting (429) or gateway timeouts (504).
 * Nothing here throws; failures resolve to null / empty results.
 */

export const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
export const CACHE_TTL_MS = 14 * 24 * 3600_000;
export const FAILURE_TTL_MS = 3600_000;
export const BACKOFF_MS = 3600_000;
export const MAX_CALLS_PER_DAY = 6;
export const TILE_DEG = 0.5;
/** Radius buckets in km; requests above the largest bucket are clamped to it. */
export const RADIUS_BUCKETS = [25, 50, 100];
/** Half-diagonal of a 0.5° tile (worst case, at the equator) so one query covers the whole tile. */
const TILE_PAD_KM = 40;
export const SHORE_RADIUS_M = 1500;
/** Maximum spots per coastline query (keeps the union small). */
export const MAX_SHORE_POINTS = 15;
const KEY_PREFIX = 'gust:osm:';
const FETCH_TIMEOUT_MS = 25_000;

export type KV = Pick<Storage, 'getItem' | 'setItem'>;

export interface OverpassDeps {
  fetch?: typeof fetch;
  /** Defaults to localStorage, or an in-memory store when that is unavailable. */
  storage?: KV;
  now?: () => number;
}

interface Resolved {
  fetch: typeof fetch | undefined;
  storage: KV;
  now: () => number;
}

const memory = new Map<string, string>();
const memoryKV: KV = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };

function defaultStorage(): KV {
  try {
    return globalThis.localStorage ?? memoryKV;
  } catch {
    return memoryKV;
  }
}

function resolve(deps: OverpassDeps = {}): Resolved {
  return { fetch: deps.fetch ?? globalThis.fetch?.bind(globalThis), storage: deps.storage ?? defaultStorage(), now: deps.now ?? Date.now };
}

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: LatLon;
  geometry?: (LatLon | null)[];
  tags?: Record<string, string>;
}

export interface OsmKiteSpot {
  /** `<type>-<id>`, e.g. `node-123`. */
  key: string;
  name: string;
  lat: number;
  lon: number;
}

export const DEFAULT_OSM_NAME = 'Kite spot (OSM)';

const coord = (n: number) => Number(n.toFixed(5));

/** Overpass QL for kitesurfing features (`sport=kitesurfing`, also inside `;` lists). */
export function buildKiteQuery(center: LatLon, radiusM: number): string {
  const r = Math.round(radiusM);
  return `[out:json][timeout:20];nwr["sport"~"kitesurfing"](around:${r},${coord(center.lat)},${coord(center.lon)});out tags center;`;
}

/** Overpass QL for coastline and water-polygon ways near any of `points` (one batched union). */
export function buildShoreQuery(points: readonly LatLon[], radiusM = SHORE_RADIUS_M): string {
  const r = Math.round(radiusM);
  const parts: string[] = [];
  for (const p of points) {
    const at = `(around:${r},${coord(p.lat)},${coord(p.lon)})`;
    parts.push(`way["natural"="coastline"]${at};`, `way["natural"="water"]${at};`);
  }
  return `[out:json][timeout:20];(${parts.join('')});out geom;`;
}

function elements(json: unknown): OsmElement[] {
  if (!json || typeof json !== 'object') return [];
  const els = (json as { elements?: unknown }).elements;
  return Array.isArray(els) ? (els as OsmElement[]) : [];
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function hasKiteSport(tags: Record<string, string> | undefined): boolean {
  if (!tags?.sport) return true; // trust the query when tags are absent
  return tags.sport.split(';').some((s) => s.trim() === 'kitesurfing');
}

/** Parse an Overpass `out center` response into kite spots. */
export function parseKiteSpots(json: unknown): OsmKiteSpot[] {
  const out: OsmKiteSpot[] = [];
  const seen = new Set<string>();
  for (const el of elements(json)) {
    if (!el || (el.type !== 'node' && el.type !== 'way' && el.type !== 'relation') || !isNum(el.id)) continue;
    const lat = isNum(el.lat) ? el.lat : el.center?.lat;
    const lon = isNum(el.lon) ? el.lon : el.center?.lon;
    if (!isNum(lat) || !isNum(lon)) continue;
    if (!hasKiteSport(el.tags)) continue;
    const key = `${el.type}-${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = el.tags ?? {};
    const name = (t.name ?? t['name:en'] ?? t.description ?? '').trim() || DEFAULT_OSM_NAME;
    out.push({ key, name, lat, lon });
  }
  return out;
}

/** Parse an Overpass `out geom` response into shore features. */
export function parseShoreFeatures(json: unknown): ShoreFeature[] {
  const out: ShoreFeature[] = [];
  for (const el of elements(json)) {
    if (!el || el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const natural = el.tags?.natural;
    const kind = natural === 'coastline' ? 'coastline' : natural === 'water' ? 'water' : null;
    if (!kind) continue;
    const points = el.geometry.filter((p): p is LatLon => !!p && isNum(p.lat) && isNum(p.lon)).map((p) => ({ lat: p.lat, lon: p.lon }));
    if (points.length >= 2) out.push({ kind, points });
  }
  return out;
}

export interface Tile {
  key: string;
  center: LatLon;
  bucketKm: number;
  /** Query radius covering every point in the tile out to `bucketKm`. */
  radiusM: number;
}

function tileWith(center: LatLon, bucketKm: number): Tile {
  const lat = Math.round(center.lat / TILE_DEG) * TILE_DEG;
  let lon = Math.round(center.lon / TILE_DEG) * TILE_DEG;
  if (lon >= 180) lon -= 360;
  return { key: `${lat.toFixed(1)},${lon.toFixed(1)}:r${bucketKm}`, center: { lat, lon }, bucketKm, radiusM: (bucketKm + TILE_PAD_KM) * 1000 };
}

export function radiusBucket(radiusKm: number): number {
  return RADIUS_BUCKETS.find((b) => radiusKm <= b) ?? RADIUS_BUCKETS[RADIUS_BUCKETS.length - 1];
}

/** Coarse cache tile for a location and search radius. */
export function tileFor(center: LatLon, radiusKm: number): Tile {
  return tileWith(center, radiusBucket(radiusKm));
}

interface CacheEntry<T> {
  at: number;
  ttl: number;
  ok: boolean;
  value: T;
}

function readJson<T>(s: KV, key: string): T | undefined {
  try {
    const raw = s.getItem(KEY_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(s: KV, key: string, value: unknown): void {
  try {
    s.setItem(KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled: run uncached.
  }
}

/** Fresh cache entry (success or cached failure), or undefined when missing/expired. */
export function cacheGet<T>(key: string, deps?: OverpassDeps): CacheEntry<T> | undefined {
  const d = resolve(deps);
  const e = readJson<CacheEntry<T>>(d.storage, key);
  if (!e || typeof e.at !== 'number' || d.now() - e.at > e.ttl) return undefined;
  return e;
}

export function cacheSet<T>(key: string, value: T, ok: boolean, deps?: OverpassDeps): void {
  const d = resolve(deps);
  writeJson(d.storage, key, { at: d.now(), ttl: ok ? CACHE_TTL_MS : FAILURE_TTL_MS, ok, value } satisfies CacheEntry<T>);
}

interface Budget {
  day: string;
  n: number;
  backoffUntil?: number;
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

function readBudget(d: Resolved): Budget {
  const b = readJson<Budget>(d.storage, 'budget');
  const today = dayOf(d.now());
  if (!b || b.day !== today) return { day: today, n: 0, backoffUntil: b?.backoffUntil };
  return b;
}

/** True when the device may make another Overpass request right now. */
export function canCall(deps?: OverpassDeps): boolean {
  const d = resolve(deps);
  if (!d.fetch) return false;
  const b = readBudget(d);
  return b.n < MAX_CALLS_PER_DAY && !(b.backoffUntil && d.now() < b.backoffUntil);
}

/**
 * POST a query to Overpass, trying each endpoint in turn. Returns parsed JSON or null.
 * Every HTTP attempt counts against the daily cap.
 */
export async function overpassPost(query: string, deps?: OverpassDeps): Promise<unknown | null> {
  const d = resolve(deps);
  const doFetch = d.fetch;
  if (!doFetch) return null;
  for (const url of ENDPOINTS) {
    if (!canCall(deps)) return null;
    const b = readBudget(d);
    b.n += 1;
    writeJson(d.storage, 'budget', b);
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl?.signal,
      });
      if (res.ok) return await res.json();
      // 400 = bad query: another server won't help (cached as a failure by the caller).
      if (res.status === 400) return null;
      // 429 (rate limited), 504 (busy), 406 (client rejected), ...: try the next instance, then back off.
    } catch {
      // network error or timeout: try the next endpoint
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const nb = readBudget(d);
  nb.backoffUntil = d.now() + BACKOFF_MS;
  writeJson(d.storage, 'budget', nb);
  return null;
}

/** Kitesurfing spots around `center`, served from the tile cache when possible. */
export async function fetchKiteSpots(center: LatLon, radiusKm: number, deps?: OverpassDeps): Promise<{ tile: Tile; spots: OsmKiteSpot[] }> {
  const tile = tileFor(center, radiusKm);
  try {
    // A cached larger bucket for the same tile covers smaller radii.
    for (const b of RADIUS_BUCKETS) {
      if (b < tile.bucketKm) continue;
      const t = tileWith(center, b);
      const hit = cacheGet<OsmKiteSpot[]>(`kite:${t.key}`, deps);
      if (hit?.ok) return { tile: t, spots: hit.value };
      if (hit && b === tile.bucketKm) return { tile, spots: [] }; // cached failure
    }
    if (!canCall(deps)) return { tile, spots: [] };
    const json = await overpassPost(buildKiteQuery(tile.center, tile.radiusM), deps);
    if (json === null) {
      cacheSet(`kite:${tile.key}`, [], false, deps);
      return { tile, spots: [] };
    }
    const spots = parseKiteSpots(json);
    cacheSet(`kite:${tile.key}`, spots, true, deps);
    return { tile, spots };
  } catch {
    return { tile, spots: [] };
  }
}

/**
 * Coastline / water ways near `points` (one batched query, uncached: callers cache the derived
 * sectors, which are far smaller than the geometry). Returns null on failure.
 */
export async function fetchShoreFeatures(points: readonly LatLon[], deps?: OverpassDeps): Promise<ShoreFeature[] | null> {
  if (points.length === 0) return [];
  try {
    if (!canCall(deps)) return null;
    const json = await overpassPost(buildShoreQuery(points.slice(0, MAX_SHORE_POINTS)), deps);
    return json === null ? null : parseShoreFeatures(json);
  } catch {
    return null;
  }
}
