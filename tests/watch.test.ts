import { describe, expect, it } from 'vitest';
import { favoriteItems, favoritesFirst, watchSets, type SpotGroup } from '../src/lib/watch';
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

  it('is empty without favourites or an origin', () => {
    expect(favoriteItems(all, undefined, groups, { lat: 0, lon: 0 })).toEqual([]);
    expect(favoriteItems(all, [], groups, { lat: 0, lon: 0 })).toEqual([]);
    expect(favoriteItems(all, ['fav'], groups, null)).toEqual([]);
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
