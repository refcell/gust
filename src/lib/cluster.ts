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
 * `radius` px of it. A grid of `radius`-sized cells keeps lookups local. Deterministic and pure.
 */
export function clusterPoints<T>(points: readonly (Pt & { item: T })[], radius = CLUSTER_PX): Cluster<T>[] {
  const r = Math.max(1, radius);
  const cell = (v: number) => Math.floor(v / r);
  const grid = new Map<string, number[]>();
  points.forEach((p, i) => {
    const k = `${cell(p.x)},${cell(p.y)}`;
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
    const cx = cell(seed.x);
    const cy = cell(seed.y);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (used[j]) continue;
          const p = points[j];
          if (Math.hypot(p.x - seed.x, p.y - seed.y) <= r) {
            used[j] = 1;
            members.push(j);
          }
        }
      }
    }
    // Keep members in input order so the cluster list is stable.
    members.sort((a, b) => a - b);
    out.push({
      items: members.map((m) => points[m].item),
      x: members.reduce((s, m) => s + points[m].x, 0) / members.length,
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
