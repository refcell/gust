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
 * `origin`, nearest first. Needs an origin for the distance; returns [] without one.
 */
export function favoriteItems(allSpots: readonly Spot[], favorites: readonly string[] | undefined, groups: readonly SpotGroup[], origin: LatLon | null): NearbySpot[] {
  if (!origin || !favorites?.length) return [];
  const fav = new Set(favorites);
  const shown = new Set<string>();
  for (const g of groups) for (const n of g.items) shown.add(n.spot.id);
  return allSpots
    .filter((s) => fav.has(s.id) && !shown.has(s.id))
    .map((spot) => ({ spot, distanceKm: distanceKm(origin, spot) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
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
