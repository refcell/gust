import { inferShore } from '../lib/coastline';
import { distanceKm, type LatLon } from '../lib/geo';
import { cacheGet, cacheSet, fetchKiteSpots, fetchShoreFeatures, planShoreQuery, tileFor, type OsmKiteSpot, type OverpassDeps } from '../lib/overpass';
import { compass, type Sector } from '../lib/sectors';
import { mergeSpots } from '../lib/spots';
import type { Spot } from '../lib/types';

/** Spot key (`node-123`) -> inferred shore (seaward normal + sectors), or null when no shore was found. */
type ShoreMap = Record<string, { normal: number; sectors: Sector[] } | null>;

const DEDUPE_KM = 1.5;
const inflight = new Map<string, Promise<Spot[]>>();

/** Seaward normals for `spots`, cached per tile. Spots missing from the result are unknown. */
async function shoreFor(tileKey: string, spots: OsmKiteSpot[], deps?: OverpassDeps): Promise<ShoreMap> {
  const key = `shore:${tileKey}`;
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
