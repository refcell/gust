import { describe, expect, it } from 'vitest';
import { scoreWind } from '../src/lib/score';
import type { Sector } from '../src/lib/sectors';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import data from '../data/spots.json';

interface RawSpot {
  id: string;
  sectors: Sector[];
  notes: string;
}

const spots = data as unknown as RawSpot[];
const byId = new Map(spots.map((s) => [s.id, s]));

function spot(id: string): RawSpot {
  const s = byId.get(id);
  if (!s) throw new Error(`missing spot ${id}`);
  return s;
}

function rate(id: string, dirDeg: number, speedKn = 22, gustKn = 27) {
  return scoreWind({ speedKn, gustKn, dirDeg }, spot(id).sectors, DEFAULT_SETTINGS).rating;
}

/** Clockwise width of a sector in degrees. */
function width([from, to]: Sector): number {
  if (Math.abs(to - from) >= 360) return 360;
  return (((to - from) % 360) + 360) % 360;
}

/** Spots allowed to use [0, 360]: causeways, sandbars and lagoons with launches on every side. */
const ANY_DIRECTION = ['skyway-beach', 'sanibel-causeway', 'mar-menor', 'trabucador', 'brouwersdam', 'texas-city-dike'];

describe('dataset safety: offshore and side-off wind never scores good', () => {
  it('aruba-hadicurari: NE/E trades are side-off, not good', () => {
    expect(rate('aruba-hadicurari', 60)).not.toBe('good');
    expect(rate('aruba-hadicurari', 90)).not.toBe('good');
  });

  it('crissy-field: E wind is offshore', () => {
    expect(rate('crissy-field', 90)).toBe('offshore');
    expect(rate('crissy-field', 290)).toBe('good');
  });

  it('kanaha: S wind is offshore, not good', () => {
    expect(rate('kanaha', 200)).not.toBe('good');
    expect(rate('kanaha', 45)).toBe('good');
  });

  it('hood river: S wind across the gorge is not good', () => {
    expect(rate('hood-river-event-site', 180)).not.toBe('good');
    expect(rate('hood-river-event-site', 270)).toBe('good');
  });

  it('side-off flat-water spots do not rate their side-off trades good', () => {
    expect(rate('spi-kite-beach', 135)).not.toBe('good');
    expect(rate('bird-island-basin', 135)).not.toBe('good');
    expect(rate('bonaire-atlantis', 80)).not.toBe('good');
    expect(rate('diamond-head', 45)).not.toBe('good');
    expect(rate('cape-verde-ponta-preta', 45)).not.toBe('good');
    expect(rate('rio-vista', 300)).not.toBe('good');
  });

  it('only documented any-direction spots use [0, 360]', () => {
    const full = spots.filter((s) => s.sectors.some((x) => width(x) >= 360)).map((s) => s.id);
    expect(full.sort()).toEqual([...ANY_DIRECTION].sort());
    for (const id of ANY_DIRECTION) expect(spot(id).notes).toMatch(/^Any direction/);
  });

  it('no other spot has a total rideable width over 220°', () => {
    const wide = spots
      .filter((s) => !ANY_DIRECTION.includes(s.id))
      .map((s) => ({ id: s.id, w: s.sectors.reduce((a, x) => a + width(x), 0) }))
      .filter((x) => x.w > 220);
    expect(wide).toEqual([]);
  });
});

describe('notes length', () => {
  it('keeps every note within 140 characters (data/README)', () => {
    const long = (data as { id: string; notes?: string }[]).filter((s) => (s.notes ?? '').length > 140).map((s) => s.id);
    expect(long).toEqual([]);
  });
});
