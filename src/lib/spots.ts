import { bbox, distanceKm, type LatLon } from './geo';
import type { Spot } from './types';

export interface NearbySpot {
  spot: Spot;
  distanceKm: number;
}

/** Spots within `radiusKm` of `center`, nearest first. */
export function nearbySpots(spots: readonly Spot[], center: LatLon, radiusKm: number, limit = 40): NearbySpot[] {
  const b = bbox(center, radiusKm);
  const out: NearbySpot[] = [];
  for (const spot of spots) {
    if (spot.lat < b.south || spot.lat > b.north) continue;
    // Skip the longitude prefilter if the box crosses the antimeridian.
    if (b.west > -180 && b.east < 180 && (spot.lon < b.west || spot.lon > b.east)) continue;
    const d = distanceKm(center, spot);
    if (d <= radiusKm) out.push({ spot, distanceKm: d });
  }
  out.sort((a, b2) => a.distanceKm - b2.distanceKm);
  return out.slice(0, limit);
}

/** The `n` nearest spots regardless of radius (for the "nothing nearby" state). */
export function nearestSpots(spots: readonly Spot[], center: LatLon, n = 5): NearbySpot[] {
  return spots
    .map((spot) => ({ spot, distanceKm: distanceKm(center, spot) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, n);
}

/** Merge spot lists, dropping later spots within `dedupeKm` of an earlier one. */
export function mergeSpots(primary: readonly Spot[], extra: readonly Spot[], dedupeKm = 1.5): Spot[] {
  const out = [...primary];
  for (const s of extra) {
    if (!out.some((p) => distanceKm(p, s) < dedupeKm)) out.push(s);
  }
  return out;
}
