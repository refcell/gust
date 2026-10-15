/**
 * Offline coordinate check of curated spots against OSM shore data (scripts/check-shore.ts).
 * Reuses the sector-inference Overpass path (`fetchSpotFeatures` / `politeFetch`: same query and
 * parse, 120 s per request, >= 5 s gap, backoff) and `nearestShorePoint` (src/lib/coastline).
 * Pure except `checkAll`, whose I/O is injected (tests mock it).
 */
import { nearestShorePoint, type ShoreFeature } from '../src/lib/coastline';
import { fetchSpotFeatures, politeFetch, samePlace, type CuratedSpot, type InferDeps } from './sector-suggest';

/** Spots farther than this from any shore are listed as likely mispositioned, m. */
export const FAR_FROM_SHORE_M = 300;
/** `--propose` lists spots with distanceM in (PROPOSE_MIN_M, PROPOSE_MAX_M]. */
export const PROPOSE_MIN_M = 150;
export const PROPOSE_MAX_M = 3000;

export interface MeasuredCheck {
  id: string;
  lat: number;
  lon: number;
  distanceM: number;
  /** Kind of the nearest shore feature as src/lib/coastline classifies it. */
  shoreKind: ShoreFeature['kind'];
  nearestLat: number;
  nearestLon: number;
}

export interface FailedCheck {
  id: string;
  lat: number;
  lon: number;
  /** `no-shore-within-range` (nothing in the ~2 km query box) or `overpass-request-failed`. */
  reason: string;
}

export type ShoreCheck = MeasuredCheck | FailedCheck;

export interface PositionProposal {
  id: string;
  name: string;
  /** Current spot coordinates the proposal was made for (apply skips spots that moved since). */
  lat: number;
  lon: number;
  distanceM: number;
  shoreKind: ShoreFeature['kind'];
  /** Nearest shore point; a reviewer may edit these before approving. */
  proposedLat: number;
  proposedLon: number;
  review?: 'approved' | 'rejected';
}

export const OVERPASS_FAILED = 'overpass-request-failed';
export const NO_SHORE = 'no-shore-within-range';

export const isMeasured = (c: ShoreCheck): c is MeasuredCheck => 'distanceM' in c;

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** Check entry for one spot from the shore features around it (null = the request failed). */
export function checkFor(spot: CuratedSpot, features: readonly ShoreFeature[] | null): ShoreCheck {
  const base = { id: spot.id, lat: spot.lat, lon: spot.lon };
  if (!features) return { ...base, reason: OVERPASS_FAILED };
  const n = nearestShorePoint(spot, features);
  if (!n) return { ...base, reason: NO_SHORE };
  return { ...base, distanceM: Math.round(n.distanceKm * 1000), shoreKind: n.kind, nearestLat: r5(n.point.lat), nearestLon: r5(n.point.lon) };
}

/** A completed check at the spot's current coordinates (failed requests are retried). */
export const isDone = (c: ShoreCheck, spot: { lat: number; lon: number }): boolean => samePlace(c, spot) && (isMeasured(c) || c.reason !== OVERPASS_FAILED);

/** Spots still to check: optional id filter, minus spots done at their current coordinates, then the limit. */
export function selectPending<T extends CuratedSpot>(spots: readonly T[], prev: readonly ShoreCheck[], opts: { only?: readonly string[]; limit?: number } = {}): T[] {
  const byId = new Map(prev.map((c) => [c.id, c]));
  const only = opts.only && opts.only.length ? new Set(opts.only) : null;
  const pending = spots.filter((s) => (!only || only.has(s.id)) && !(byId.has(s.id) && isDone(byId.get(s.id)!, s)));
  return opts.limit !== undefined ? pending.slice(0, Math.max(0, opts.limit)) : pending;
}

/**
 * Merge new checks over earlier ones, in `spots` order, dropping ids no longer curated. A failed
 * request never replaces a completed check at the same coordinates.
 */
export function mergeChecks(spots: readonly CuratedSpot[], prev: readonly ShoreCheck[], next: readonly ShoreCheck[]): ShoreCheck[] {
  const byId = new Map(prev.map((c) => [c.id, c]));
  for (const n of next) {
    const p = byId.get(n.id);
    if (p && !isMeasured(n) && n.reason === OVERPASS_FAILED && samePlace(p, n) && isDone(p, p)) continue;
    byId.set(n.id, n);
  }
  return spots.map((s) => byId.get(s.id)).filter((c): c is ShoreCheck => !!c);
}

/** Human summary: counts, spots > FAR_FROM_SHORE_M from any shore (farthest first), no shore in range. */
export function summarize(checks: readonly ShoreCheck[], total: number): string[] {
  const measured = checks.filter(isMeasured);
  const failed = checks.filter((c): c is FailedCheck => !isMeasured(c));
  const noShore = failed.filter((c) => c.reason === NO_SHORE);
  const far = measured.filter((c) => c.distanceM > FAR_FROM_SHORE_M).sort((a, b) => b.distanceM - a.distanceM || a.id.localeCompare(b.id));
  const kinds = new Map<string, number>();
  for (const c of measured) kinds.set(c.shoreKind, (kinds.get(c.shoreKind) ?? 0) + 1);
  const lines = [
    `${checks.length}/${total} spots checked: ${measured.length} measured (${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}), ` +
      `${noShore.length} no shore in range, ${failed.length - noShore.length} Overpass failures`,
    `${far.length} farther than ${FAR_FROM_SHORE_M} m from any shore:`,
    ...far.map((c) => `  ${c.id}: ${c.distanceM} m (${c.shoreKind}) nearest ${c.nearestLat},${c.nearestLon}`),
    `${noShore.length} with no shore in range:`,
    ...noShore.map((c) => `  ${c.id}`).sort(),
  ];
  return lines;
}

/**
 * Position proposals for spots measured (150, 3000] m from the shore at their current coordinates.
 * Existing entries for the same spot position keep their review decision and (possibly edited)
 * proposed coordinates.
 */
export function proposePositions(spots: readonly CuratedSpot[], checks: readonly ShoreCheck[], prev: readonly PositionProposal[] = []): PositionProposal[] {
  const at = new Map(spots.map((s) => [s.id, s]));
  const old = new Map(prev.map((p) => [p.id, p]));
  const out: PositionProposal[] = [];
  for (const c of checks) {
    const spot = at.get(c.id);
    if (!spot || !isMeasured(c) || !samePlace(c, spot) || c.distanceM <= PROPOSE_MIN_M || c.distanceM > PROPOSE_MAX_M) continue;
    const p = old.get(c.id);
    if (p && samePlace(p, spot)) {
      out.push({ ...p, distanceM: c.distanceM, shoreKind: c.shoreKind });
      continue;
    }
    out.push({ id: c.id, name: spot.name, lat: spot.lat, lon: spot.lon, distanceM: c.distanceM, shoreKind: c.shoreKind, proposedLat: c.nearestLat, proposedLon: c.nearestLon });
  }
  return out;
}

/** Move spots to approved proposals whose recorded coordinates still match (returns a new array). */
export function applyPositions<T extends CuratedSpot>(spots: readonly T[], proposals: readonly PositionProposal[]): { spots: T[]; applied: string[]; skipped: string[] } {
  const byId = new Map(proposals.filter((p) => p.review === 'approved').map((p) => [p.id, p]));
  const applied: string[] = [];
  const skipped: string[] = [];
  const out = spots.map((spot) => {
    const p = byId.get(spot.id);
    if (!p) return spot;
    if (!samePlace(p, spot)) {
      skipped.push(`${spot.id} (spot moved since the proposal)`);
      return spot;
    }
    if (!Number.isFinite(p.proposedLat) || !Number.isFinite(p.proposedLon) || Math.abs(p.proposedLat) > 90 || Math.abs(p.proposedLon) > 180) {
      skipped.push(`${spot.id} (invalid proposed coordinates)`);
      return spot;
    }
    applied.push(spot.id);
    return { ...spot, lat: p.proposedLat, lon: p.proposedLon };
  });
  for (const id of byId.keys()) if (!spots.some((s) => s.id === id)) skipped.push(`${id} (no such spot)`);
  return { spots: out, applied, skipped };
}

export interface CheckDeps extends InferDeps {
  onCheck?: (results: readonly ShoreCheck[]) => void;
}

/** One Overpass request (plus retries) per spot, in order; never throws. */
export async function checkAll(spots: readonly CuratedSpot[], d: CheckDeps): Promise<ShoreCheck[]> {
  const http = politeFetch(d);
  const out: ShoreCheck[] = [];
  for (const spot of spots) {
    let features: ShoreFeature[] | null;
    try {
      features = await fetchSpotFeatures(spot, http, d);
    } catch {
      features = null;
    }
    const c = checkFor(spot, features);
    d.log?.(isMeasured(c) ? `${c.id}: ${c.distanceM} m from ${c.shoreKind}` : `${c.id}: ${c.reason}`);
    out.push(c);
    d.onCheck?.(out);
  }
  return out;
}
