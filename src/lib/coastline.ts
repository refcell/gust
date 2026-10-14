import type { LatLon } from './geo';
import { normDeg, type Sector } from './sectors';

/**
 * Shore-orientation inference from OpenStreetMap geometry. Pure functions, no I/O.
 *
 * OSM `natural=coastline` ways are drawn with land on the LEFT and water on the RIGHT of the
 * direction of travel, so the seaward normal of a segment is its bearing + 90°.
 * Closed `natural=water` ways (lakes, reservoirs) have water INSIDE; the normal points toward the
 * polygon interior, which depends on the ring's winding order. Multipolygon lakes are reduced to
 * their closed outer rings (water inside) before they get here; see `assembleRings`.
 * `river` features (river polygons) only count for distance: when the nearest shore is a river,
 * the orientation is ambiguous and no inference is made.
 */

export interface ShoreFeature {
  kind: 'coastline' | 'water' | 'river';
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
}

/** Spots farther than this from any shore get no inference. */
export const MAX_SHORE_KM = 1.5;
/** Half-width of the rideable sector around the seaward normal. */
export const SECTOR_HALF_WIDTH = 100;
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
  const open = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  const rings: LatLon[][] = [];
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
  }
  return rings;
}

/** Rideable sector for a given seaward normal: [normal - 100, normal + 100], normalised. */
export function sectorsFromNormal(normalDeg: number, halfWidth = SECTOR_HALF_WIDTH): Sector[] {
  return [[normDeg(normalDeg - halfWidth), normDeg(normalDeg + halfWidth)]];
}

/**
 * Infer the shore orientation at `spot` from the nearest shore segment among `features`.
 * Returns null when nothing usable is within `maxKm`.
 */
export function inferShore(spot: LatLon, features: readonly ShoreFeature[], maxKm = MAX_SHORE_KM): ShoreInference | null {
  let best: { d: number; normal: number; river: boolean } | null = null;
  for (const f of features) {
    if (f.points.length < 2) continue;
    const pts = f.points.map((p) => project(spot, p));
    // Water polygons: water is on the left for CCW rings, on the right for CW rings.
    let side = 90;
    const river = f.kind === 'river';
    if (f.kind === 'water') {
      if (!isClosed(f.points)) continue;
      const area = signedArea(pts);
      if (Math.abs(area) / 1e6 < MIN_WATER_AREA_KM2) continue;
      side = area > 0 ? -90 : 90;
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.x === b.x && a.y === b.y) continue;
      const d = distToSegment(a, b);
      if (!best || d < best.d) best = { d, normal: normDeg(planarBearing(a, b) + side), river };
    }
  }
  // Nearest shore is a river: which bank faces which way is ambiguous, so leave it unknown.
  if (!best || best.river || best.d / 1000 > maxKm) return null;
  return { normalDeg: best.normal, distanceKm: best.d / 1000, sectors: sectorsFromNormal(best.normal) };
}
