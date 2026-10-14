import type { Rating } from './score';
import type { Pt } from './tiles';

/** Screen distance (px) under which markers merge into one cluster. */
export const CLUSTER_PX = 40;

export interface Cluster<T> {
  items: T[];
  /** Centroid of the members, in the same pixel space as the input. */
  x: number;
  y: number;
}

/**
 * Greedy grid clustering in pixel space. Points are taken in input order (put higher-priority
 * points first); each unassigned point seeds a cluster and absorbs every unassigned point within
 * `radius` px of it. A grid of cells at least `radius` wide keeps lookups local. Deterministic and pure.
 *
 * With `period` (the world width in px), x is periodic: points either side of the antimeridian
 * are neighbours, and centroids are averaged across the seam and wrapped into [0, period).
 */
export function clusterPoints<T>(points: readonly (Pt & { item: T })[], radius = CLUSTER_PX, period?: number): Cluster<T>[] {
  const r = Math.max(1, radius);
  const P = period !== undefined && Number.isFinite(period) && period > 0 ? period : undefined;
  // Periodic: an integral number of equal cells (each >= r) so the grid wraps cleanly.
  const nx = P ? Math.max(1, Math.floor(P / r)) : 0;
  const size = P ? P / nx : r;
  const wrapX = (x: number) => (P ? ((x % P) + P) % P : x);
  const cellX = (x: number) => (P ? Math.min(nx - 1, Math.floor(wrapX(x) / size)) : Math.floor(x / size));
  const cellY = (y: number) => Math.floor(y / size);
  /** Signed x offset from a to b (shortest way round when periodic). */
  const dxOf = (a: number, b: number) => {
    let d = b - a;
    if (P) {
      d = ((d % P) + P) % P;
      if (d > P / 2) d -= P;
    }
    return d;
  };
  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const k = `${cellX(p.x)},${cellY(p.y)}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const used = new Uint8Array(points.length);
  const out: Cluster<T>[] = [];
  points.forEach((seed, i) => {
    if (used[i]) return;
    used[i] = 1;
    const members = [i];
    const cx = cellX(seed.x);
    const cy = cellY(seed.y);
    const cols = new Set<number>();
    for (let gx = cx - 1; gx <= cx + 1; gx++) cols.add(P ? ((gx % nx) + nx) % nx : gx);
    for (const gx of cols) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (used[j]) continue;
          const p = points[j];
          if (Math.hypot(dxOf(seed.x, p.x), p.y - seed.y) <= r) {
            used[j] = 1;
            members.push(j);
          }
        }
      }
    }
    // Keep members in input order so the cluster list is stable.
    members.sort((a, b) => a - b);
    const meanDx = members.reduce((s, m) => s + dxOf(seed.x, points[m].x), 0) / members.length;
    out.push({
      items: members.map((m) => points[m].item),
      x: P ? wrapX(seed.x + meanDx) : seed.x + meanDx,
      y: members.reduce((s, m) => s + points[m].y, 0) / members.length,
    });
  });
  return out;
}

/** Most rideable first. Offshore is unsafe, so it ranks below "no wind". */
const RANK: Record<Rating, number> = { good: 6, ok: 5, light: 4, strong: 3, poor: 2, offshore: 1 };

/** Best rating among a set (null = no data for any member). */
export function bestRating(ratings: readonly (Rating | null | undefined)[]): Rating | null {
  let best: Rating | null = null;
  for (const r of ratings) if (r && (!best || RANK[r] > RANK[best])) best = r;
  return best;
}
