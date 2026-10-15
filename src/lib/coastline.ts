import type { LatLon } from './geo';
import { normDeg, type Sector } from './sectors';

/**
 * Shore-orientation inference from OpenStreetMap geometry. Pure functions, no I/O.
 *
 * OSM `natural=coastline` ways are drawn with land on the LEFT and water on the RIGHT of the
 * direction of travel, so the seaward normal of a segment is its bearing + 90°.
 * Closed `natural=water` ways (lakes, reservoirs) have water INSIDE; the normal points toward the
 * polygon interior, which depends on the ring's winding order. Multipolygon lakes are split into
 * their closed outer rings (`water`, water inside) and closed inner rings (`island`, water OUTSIDE,
 * so the normal points away from the island interior); see `assembleRings`.
 * `river` features (river polygons) and `ambiguous` features (unclosed water ways, multipolygon
 * fragments that never close) only count for distance: when the nearest shore is one of them, the
 * orientation is unknown and no inference is made. A farther boundary is never used instead.
 */

export interface ShoreFeature {
  kind: 'coastline' | 'water' | 'island' | 'river' | 'ambiguous';
  /** Nodes in way order (closed rings repeat the first node at the end). */
  points: LatLon[];
}

export interface ShoreInference {
  /** Bearing the shore faces toward the water (wind FROM this direction is dead onshore). */
  normalDeg: number;
  /** Distance from the spot to the nearest shore segment, km. */
  distanceKm: number;
  /** Rideable wind-from sector: onshore through side-shore, offshore excluded. */
  sectors: Sector[];
  /** Kind of the nearest shore feature (`coastline` = sea, `water` / `island` = lake). */
  kind: 'coastline' | 'water' | 'island';
}

/** Why `inferShoreDetailed` made no inference. */
export type NoShoreReason = 'no-shore-within-range' | 'nearest-shore-river' | 'nearest-shore-ambiguous';

/** Spots farther than this from any shore get no inference. */
export const MAX_SHORE_KM = 1.5;
/**
 * Half-width of the rideable sector around the seaward normal. 90° = side-shore at most: inferred
 * orientation is approximate, so cross-offshore is never included (the scorer's marginal band
 * already adds MARGINAL_DEG beyond this, capped at "ok").
 */
export const SECTOR_HALF_WIDTH = 90;
/** Ignore water polygons smaller than this (ponds, pools), km². */
export const MIN_WATER_AREA_KM2 = 0.5;

const M_PER_DEG = 111_320;

interface XY {
  x: number;
  y: number;
}

/** Local equirectangular projection around `origin`, metres (x east, y north). */
function project(origin: LatLon, p: LatLon): XY {
  let dLon = p.lon - origin.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  return { x: dLon * M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180), y: (p.lat - origin.lat) * M_PER_DEG };
}

/** Compass bearing of the vector a -> b in projected space. */
function planarBearing(a: XY, b: XY): number {
  return normDeg((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI);
}

/** Distance from the origin (0,0) to segment a-b, metres. */
function distToSegment(a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
  return Math.hypot(a.x + t * dx, a.y + t * dy);
}

/** Signed shoelace area in projected space, m². Positive = counter-clockwise. */
function signedArea(pts: XY[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function isClosed(points: LatLon[]): boolean {
  if (points.length < 4) return false;
  const a = points[0];
  const b = points[points.length - 1];
  return a.lat === b.lat && a.lon === b.lon;
}

const samePoint = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon;

/**
 * Join way fragments (e.g. multipolygon `outer` members) into closed rings by matching endpoints,
 * reversing fragments as needed. Fragments that never close are dropped.
 */
export function assembleRings(ways: readonly LatLon[][]): LatLon[][] {
  return assembleRingsWithRest(ways).rings;
}

/** Like `assembleRings`, but also returns the (joined) fragments that never closed. */
export function assembleRingsWithRest(ways: readonly LatLon[][]): { rings: LatLon[][]; rest: LatLon[][] } {
  const open = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  const rings: LatLon[][] = [];
  const rest: LatLon[][] = [];
  while (open.length > 0) {
    let ring = open.shift()!;
    let grown = true;
    while (!samePoint(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < open.length; i++) {
        const w = open[i];
        let next: LatLon[] | null = null;
        if (samePoint(w[0], end)) next = w;
        else if (samePoint(w[w.length - 1], end)) next = [...w].reverse();
        if (next) {
          ring = ring.concat(next.slice(1));
          open.splice(i, 1);
          grown = true;
          break;
        }
      }
    }
    if (isClosed(ring)) rings.push(ring);
    else rest.push(ring);
  }
  return { rings, rest };
}

/** Rideable sector for a given seaward normal: [normal - halfWidth, normal + halfWidth], normalised. */
export function sectorsFromNormal(normalDeg: number, halfWidth = SECTOR_HALF_WIDTH): Sector[] {
  return [[normDeg(normalDeg - halfWidth), normDeg(normalDeg + halfWidth)]];
}

/**
 * Infer the shore orientation at `spot` from the nearest shore segment among `features`.
 * Returns null when nothing usable is within `maxKm`.
 */
export function inferShore(spot: LatLon, features: readonly ShoreFeature[], maxKm = MAX_SHORE_KM): ShoreInference | null {
  const r = inferShoreDetailed(spot, features, maxKm);
  return 'reason' in r ? null : r;
}

/** Like `inferShore`, but says why no inference was made. */
export function inferShoreDetailed(spot: LatLon, features: readonly ShoreFeature[], maxKm = MAX_SHORE_KM): ShoreInference | { reason: NoShoreReason } {
  let best: { d: number; normal: number; ambiguous: boolean; kind: ShoreFeature['kind'] } | null = null;
  for (const f of features) {
    if (f.points.length < 2) continue;
    const pts = f.points.map((p) => project(spot, p));
    let side = 90;
    let ambiguous = f.kind === 'river' || f.kind === 'ambiguous';
    if (f.kind === 'water' || f.kind === 'island') {
      if (!isClosed(f.points)) {
        // An open water way has no inside: it still blocks farther boundaries.
        ambiguous = true;
      } else {
        const area = signedArea(pts);
        if (f.kind === 'water') {
          // Lakes: water is on the left for CCW rings, on the right for CW rings.
          if (Math.abs(area) / 1e6 < MIN_WATER_AREA_KM2) continue;
          side = area > 0 ? -90 : 90;
        } else {
          // Islands (lake inner rings): land inside, water outside -> the opposite side.
          if (area === 0) ambiguous = true;
          side = area > 0 ? 90 : -90;
        }
      }
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.x === b.x && a.y === b.y) continue;
      const d = distToSegment(a, b);
      if (!best || d < best.d) best = { d, normal: normDeg(planarBearing(a, b) + side), ambiguous, kind: f.kind };
    }
  }
  // Nearest shore is a river or has no known water side: leave it unknown.
  if (!best || best.d / 1000 > maxKm) return { reason: 'no-shore-within-range' };
  if (best.ambiguous) return { reason: best.kind === 'river' ? 'nearest-shore-river' : 'nearest-shore-ambiguous' };
  const kind = best.kind === 'coastline' || best.kind === 'water' ? best.kind : 'island';
  return { normalDeg: best.normal, distanceKm: best.d / 1000, sectors: sectorsFromNormal(best.normal), kind };
}
