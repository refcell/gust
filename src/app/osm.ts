import { inferShore } from '../lib/coastline';
import { distanceKm, type LatLon } from '../lib/geo';
import { cacheGet, cacheSet, fetchKiteSpots, fetchShoreFeatures, planShoreQuery, tileFor, type OsmKiteSpot, type OverpassDeps } from '../lib/overpass';
import { compass, type Sector } from '../lib/sectors';
import { mergeSpots } from '../lib/spots';
import type { Spot } from '../lib/types';

/** Spot key (`node-123`) -> inferred shore (seaward normal + sectors), or null when no shore was found. */
type ShoreMap = Record<string, { normal: number; sectors: Sector[] } | null>;

const DEDUPE_KM = 1.5;
/**
 * Bump when shore inference changes (v2: lake-island fix + ±90° inferred sectors) so derived
 * sectors cached by older versions are ignored and recomputed.
 */
export const SHORE_CACHE_VERSION = 2;
export const shoreCacheKey = (tileKey: string) => `shore:v${SHORE_CACHE_VERSION}:${tileKey}`;
const inflight = new Map<string, Promise<Spot[]>>();

/** Seaward normals for `spots`, cached per tile. Spots missing from the result are unknown. */
async function shoreFor(tileKey: string, spots: OsmKiteSpot[], deps?: OverpassDeps): Promise<ShoreMap> {
  const key = shoreCacheKey(tileKey);
  const hit = cacheGet<ShoreMap>(key, deps);
  if (hit) return hit.ok ? hit.value : {};
  // One bbox query around the tile's new spots (nearest first; capped, see planShoreQuery).
  const plan = planShoreQuery(spots);
  if (!plan) return {};
  const features = await fetchShoreFeatures(plan.bbox, deps);
  if (!features) {
    cacheSet<ShoreMap>(key, {}, false, deps);
    return {};
  }
  const map: ShoreMap = {};
  // Spots outside the queried box stay unknown: their nearest shore may be missing from it.
  for (const s of plan.covered) {
    const inf = inferShore(s, features);
    map[s.key] = inf ? { normal: Math.round(inf.normalDeg), sectors: inf.sectors.map(([a, b]) => [Math.round(a), Math.round(b)] as Sector) } : null;
  }
  cacheSet(key, map, true, deps);
  return map;
}

function toSpot(s: OsmKiteSpot, shore: ShoreMap[string] | undefined): Spot {
  const base: Spot = { id: `osm-${s.key}`, name: s.name, lat: s.lat, lon: s.lon, source: 'osm' };
  if (shore) {
    return {
      ...base,
      sectors: shore.sectors,
      sectorSource: 'coastline',
      notes: `From OpenStreetMap. Rideable directions inferred from the coastline (shore faces ${compass(shore.normal)}); check locally.`,
    };
  }
  return { ...base, sectorSource: 'unknown', notes: 'From OpenStreetMap. Rideable directions unknown; scored on wind speed only.' };
}

async function run(center: LatLon, radiusKm: number, curated: Spot[], deps?: OverpassDeps): Promise<Spot[]> {
  const { tile, spots } = await fetchKiteSpots(center, radiusKm, deps);
  if (spots.length === 0) return [];
  // Nearest first so a capped shore bbox covers the spots the user sees first.
  const sorted = [...spots].sort((a, b) => distanceKm(center, a) - distanceKm(center, b));
  // Drop OSM spots already covered by the curated list (and OSM duplicates such as node + area).
  const asSpots = sorted.map((s) => toSpot(s, undefined));
  const fresh = new Set(mergeSpots(curated, asSpots, DEDUPE_KM).slice(curated.length).map((s) => s.id));
  const candidates = sorted.filter((s) => fresh.has(`osm-${s.key}`));
  if (candidates.length === 0) return [];
  const shore = await shoreFor(tile.key, candidates, deps);
  return candidates.map((s) => toSpot(s, shore[s.key]));
}

/**
 * Extra kite spots from OpenStreetMap around `center` that the curated list does not cover,
 * with rideable sectors inferred from the coastline where possible. Never throws.
 */
export async function augmentWithOsm(center: LatLon, radiusKm: number, curated: Spot[], deps?: OverpassDeps): Promise<Spot[]> {
  try {
    const key = tileFor(center, radiusKm).key;
    let p = inflight.get(key);
    if (!p) {
      p = run(center, radiusKm, curated, deps).catch(() => []);
      inflight.set(key, p);
      void p.finally(() => inflight.delete(key));
    }
    return await p;
  } catch {
    return [];
  }
}

/**
 * Distinct Overpass tiles to query for `origins` (current location first, then saved places):
 * one origin per tile + radius bucket, ordered nearest-first from the first origin so the daily
 * request budget goes to the most relevant places.
 */
export function osmOrigins<T extends LatLon>(origins: readonly T[], radiusKm: number): T[] {
  if (origins.length === 0) return [];
  const ref = origins[0];
  const sorted = origins.map((o, i) => ({ o, i, d: distanceKm(ref, o) })).sort((a, b) => a.d - b.d || a.i - b.i);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const { o } of sorted) {
    const key = tileFor(o, radiusKm).key;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

/**
 * OSM spots around every origin (see osmOrigins), queried one tile at a time so the cache and the
 * daily budget apply in order, merged and deduped (by id and by distance). Never throws.
 */
export async function augmentAround(origins: readonly LatLon[], radiusKm: number, curated: Spot[], deps?: OverpassDeps): Promise<Spot[]> {
  let out: Spot[] = [];
  for (const o of osmOrigins(origins, radiusKm)) {
    const extra = await augmentWithOsm(o, radiusKm, curated, deps);
    const ids = new Set(out.map((s) => s.id));
    out = mergeSpots(out, extra.filter((s) => !ids.has(s.id)), DEDUPE_KM);
  }
  return out;
}
