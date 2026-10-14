import { describe, expect, it } from 'vitest';
import { backfillFavoriteSnapshots, favoriteItems, favoritesFirst, toggleFavoriteSnapshot, watchSets, withFavoriteSnapshots, type SpotGroup } from '../src/lib/watch';
import type { Spot } from '../src/lib/types';

const spot = (id: string, lat = 0, lon = 0): Spot => ({ id, name: id, lat, lon });
const near = (s: Spot, distanceKm = 1) => ({ spot: s, distanceKm });

const a = spot('a');
const b = spot('b');
const far1 = spot('far1', 1, 0);
const far2 = spot('far2', 2, 0);
const fav = spot('fav', 5, 0);

describe('watchSets', () => {
  it('watches radius spots and only shows fallback spots', () => {
    const groups: SpotGroup[] = [
      { items: [near(a), near(b)], fallback: false },
      { items: [near(far1), near(far2)], fallback: true },
    ];
    const r = watchSets(groups, undefined);
    expect(r.watched.map((s) => s.id)).toEqual(['a', 'b']);
    expect(r.shownOnly.map((s) => s.id)).toEqual(['far1', 'far2']);
  });

  it('watches favourites even in fallback groups, and favourites sections', () => {
    const groups: SpotGroup[] = [
      { items: [near(far1), near(far2)], fallback: true },
      { items: [near(fav, 500)], fallback: false },
    ];
    const r = watchSets(groups, ['far2', 'fav']);
    expect(r.watched.map((s) => s.id)).toEqual(['far2', 'fav']);
    expect(r.shownOnly.map((s) => s.id)).toEqual(['far1']);
  });

  it('lists a spot once, watched wins over shown-only', () => {
    const groups: SpotGroup[] = [
      { items: [near(far1)], fallback: true },
      { items: [near(far1), near(a)], fallback: false },
    ];
    const r = watchSets(groups, []);
    expect(r.watched.map((s) => s.id)).toEqual(['far1', 'a']);
    expect(r.shownOnly).toEqual([]);
  });
});

describe('favoriteItems', () => {
  const all = [a, b, far1, far2, fav];
  const groups: SpotGroup[] = [{ items: [near(a)], fallback: false }, { items: [near(far1)], fallback: true }];

  it('returns favourites no group shows, nearest first, with distances from the origin', () => {
    const r = favoriteItems(all, ['fav', 'a', 'far2', 'far1', 'missing'], groups, { lat: 0, lon: 0 });
    expect(r.map((n) => n.spot.id)).toEqual(['far2', 'fav']);
    expect(r[0].distanceKm).toBeCloseTo(222.4, 0);
  });

  it('is empty without favourites', () => {
    expect(favoriteItems(all, undefined, groups, { lat: 0, lon: 0 })).toEqual([]);
    expect(favoriteItems(all, [], groups, { lat: 0, lon: 0 })).toEqual([]);
  });

  it('without an origin still lists favourites (distance unknown, by name), and they are watched', () => {
    const r = favoriteItems(all, ['fav', 'far2'], [], null);
    expect(r.map((n) => n.spot.id)).toEqual(['far2', 'fav']);
    expect(r.every((n) => Number.isNaN(n.distanceKm))).toBe(true);
    expect(watchSets([{ items: r, fallback: false }], ['fav', 'far2']).watched.map((s) => s.id)).toEqual(['far2', 'fav']);
  });
});

describe('favoritesFirst', () => {
  it('puts favourites first and keeps the comparator within each part', () => {
    const items = [near(a, 3), near(b, 1), near(far1, 2), near(far2, 4)];
    const r = favoritesFirst(items, ['far2', 'a'], (x, y) => x.distanceKm - y.distanceKm);
    expect(r.map((n) => n.spot.id)).toEqual(['a', 'far2', 'b', 'far1']);
    expect(items[0].spot.id).toBe('a'); // input untouched
  });
});

describe('favourite snapshots', () => {
  const osmFav: Spot = { id: 'osm-1', name: 'Lagoon', lat: 40, lon: 10, source: 'osm' };

  it('keeps an OSM favourite in the universe after the OSM dataset changes', () => {
    const snaps = toggleFavoriteSnapshot([], osmFav, true);
    const universe = withFavoriteSnapshots([a, b], ['osm-1'], snaps); // OSM data no longer has osm-1
    expect(universe.map((s) => s.id)).toEqual(['a', 'b', 'osm-1']);
    const favs = favoriteItems(universe, ['osm-1'], [{ items: [near(a)], fallback: false }], { lat: 0, lon: 0 });
    expect(favs.map((n) => n.spot.id)).toEqual(['osm-1']);
  });

  it('prefers current data, ignores snapshots of non-favourites, and removes on unfavourite', () => {
    const snaps = [osmFav, { ...a, name: 'old a' }];
    expect(withFavoriteSnapshots([a], ['a', 'osm-1'], snaps)).toEqual([a, osmFav]);
    expect(withFavoriteSnapshots([a], ['a'], snaps)).toEqual([a]);
    expect(toggleFavoriteSnapshot(snaps, osmFav, false)).toEqual([{ ...a, name: 'old a' }]);
    expect(toggleFavoriteSnapshot(snaps, a, true)).toEqual([osmFav, a]);
  });

  it('backfills snapshots for favourites present in the data', () => {
    expect(backfillFavoriteSnapshots([osmFav], [a, b, fav], ['osm-1', 'fav', 'missing'])).toEqual([osmFav, fav]);
    expect(backfillFavoriteSnapshots([osmFav], [a], ['osm-1'])).toBeNull();
    expect(backfillFavoriteSnapshots([], [a], ['missing'])).toBeNull();
  });
});
