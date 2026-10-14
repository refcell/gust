import { distanceKm, type LatLon } from './geo';
import type { NearbySpot } from './spots';
import type { Spot } from './types';

export interface SpotGroup {
  items: NearbySpot[];
  /** Nearest spots shown because none are within the radius (not watched unless favourites). */
  fallback: boolean;
}

/**
 * Favourite spots that no other section shows (e.g. outside the radius), with distances from
 * `origin`, nearest first. Without an origin the distance is unknown (NaN), sorted by name.
 */
export function favoriteItems(allSpots: readonly Spot[], favorites: readonly string[] | undefined, groups: readonly SpotGroup[], origin: LatLon | null): NearbySpot[] {
  if (!favorites?.length) return [];
  const fav = new Set(favorites);
  const shown = new Set<string>();
  for (const g of groups) for (const n of g.items) shown.add(n.spot.id);
  const items = allSpots.filter((s) => fav.has(s.id) && !shown.has(s.id));
  if (!origin) return items.map((spot) => ({ spot, distanceKm: NaN })).sort((a, b) => a.spot.name.localeCompare(b.spot.name));
  return items.map((spot) => ({ spot, distanceKm: distanceKm(origin, spot) })).sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * The spot universe: current spots plus saved snapshots of favourites that are no longer in it
 * (e.g. OSM spots from another area, after travelling). Snapshots of non-favourites are ignored.
 */
export function withFavoriteSnapshots(spots: readonly Spot[], favorites: readonly string[] | undefined, snapshots: readonly Spot[]): Spot[] {
  const fav = new Set(favorites ?? []);
  if (!fav.size || !snapshots.length) return [...spots];
  const have = new Set(spots.map((s) => s.id));
  const extra = snapshots.filter((s) => fav.has(s.id) && !have.has(s.id));
  return extra.length ? [...spots, ...extra.filter((s, i) => extra.findIndex((x) => x.id === s.id) === i)] : [...spots];
}

/** Snapshot list after (un)favouriting `spot`: added (or refreshed) when favourited, removed otherwise. */
export function toggleFavoriteSnapshot(snapshots: readonly Spot[], spot: Spot, favorite: boolean): Spot[] {
  const rest = snapshots.filter((s) => s.id !== spot.id);
  return favorite ? [...rest, spot] : rest;
}

/**
 * Snapshots to add for favourites that are in `spots` but not yet saved (favourites made before
 * snapshots existed). Returns null when nothing is missing.
 */
export function backfillFavoriteSnapshots(snapshots: readonly Spot[], spots: readonly Spot[], favorites: readonly string[] | undefined): Spot[] | null {
  // Add snapshots for favourites that lack one, and refresh snapshots whose spot is still in the
  // dataset but changed (e.g. a dataset-safety correction), so a later removal never revives
  // stale sectors.
  const fav = new Set(favorites ?? []);
  const current = new Map(spots.filter((s) => fav.has(s.id)).map((s) => [s.id, s]));
  let changed = false;
  const next = snapshots.map((snap) => {
    const cur = current.get(snap.id);
    if (cur && JSON.stringify(cur) !== JSON.stringify(snap)) {
      changed = true;
      return cur;
    }
    return snap;
  });
  const have = new Set(next.map((s) => s.id));
  for (const [id, cur] of current) {
    if (have.has(id)) continue;
    next.push(cur);
    changed = true;
  }
  return changed ? next : null;
}

/**
 * Split shown spots into watched (alerts) and shown-only. Spots in non-fallback groups and every
 * favourite are watched; other fallback spots are only shown. Each spot appears once.
 */
export function watchSets(groups: readonly SpotGroup[], favorites: readonly string[] | undefined): { watched: Spot[]; shownOnly: Spot[] } {
  const fav = new Set(favorites ?? []);
  const w = new Map<string, Spot>();
  const f = new Map<string, Spot>();
  for (const g of groups) for (const n of g.items) (!g.fallback || fav.has(n.spot.id) ? w : f).set(n.spot.id, n.spot);
  for (const id of w.keys()) f.delete(id);
  return { watched: [...w.values()], shownOnly: [...f.values()] };
}

/** Favourites first, keeping the given comparator otherwise. */
export function favoritesFirst<T extends NearbySpot>(items: readonly T[], favorites: readonly string[] | undefined, cmp: (a: T, b: T) => number): T[] {
  const fav = new Set(favorites ?? []);
  return [...items].sort((a, b) => Number(fav.has(b.spot.id)) - Number(fav.has(a.spot.id)) || cmp(a, b));
}
