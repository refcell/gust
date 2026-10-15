import { describe, expect, it } from 'vitest';
import { foldText, searchSpots } from '../src/lib/spotsearch';
import type { Spot } from '../src/lib/types';

const s = (id: string, name: string): Spot => ({ id, name, lat: 0, lon: 0 });

const SPOTS = [
  s('hood-river-event-site', 'Hood River Event Site'),
  s('hood-river-hook', 'The Hook (Hood River)'),
  s('stevenson', 'Stevenson'),
  s('lagoa-de-obidos', 'Lagoa de Óbidos'),
  s('tarifa-valdevaqueros', 'Valdevaqueros (Tarifa)'),
  s('childhood-beach', 'Childhood Beach'),
  s('sao-miguel', 'São Miguel'),
];

describe('foldText', () => {
  it('lower-cases and strips diacritics', () => {
    expect(foldText('Óbidos São')).toBe('obidos sao');
  });
});

describe('searchSpots', () => {
  it('ignores terms under 2 characters', () => {
    expect(searchSpots(SPOTS, '')).toEqual([]);
    expect(searchSpots(SPOTS, ' h ')).toEqual([]);
  });

  it('matches case-insensitively on name words, ranking prefix before substring, then by name', () => {
    expect(searchSpots(SPOTS, 'HOOD').map((x) => x.id)).toEqual(['hood-river-event-site', 'hood-river-hook', 'childhood-beach']);
  });

  it('is diacritic-insensitive in both directions', () => {
    expect(searchSpots(SPOTS, 'obidos').map((x) => x.id)).toEqual(['lagoa-de-obidos']);
    expect(searchSpots(SPOTS, 'Sáo').map((x) => x.id)).toEqual(['sao-miguel']);
  });

  it('matches on the id too', () => {
    expect(searchSpots(SPOTS, 'tarifa-val').map((x) => x.id)).toEqual(['tarifa-valdevaqueros']);
    expect(searchSpots(SPOTS, 'tarifa').map((x) => x.id)).toEqual(['tarifa-valdevaqueros']);
  });

  it('matches word prefixes inside parentheses', () => {
    expect(searchSpots(SPOTS, 'river').map((x) => x.id)).toEqual(['hood-river-event-site', 'hood-river-hook']);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 9 }, (_, i) => s(`beach-${i}`, `Beach ${i}`));
    expect(searchSpots(many, 'beach')).toHaveLength(5);
    expect(searchSpots(many, 'beach', 2).map((x) => x.id)).toEqual(['beach-0', 'beach-1']);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchSpots(SPOTS, 'zz')).toEqual([]);
  });
});
