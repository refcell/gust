import { describe, expect, it } from 'vitest';
import { mergeSpots, nearbySpots, nearestSpots } from '../src/lib/spots';
import { bearing, distanceKm } from '../src/lib/geo';
import type { Spot } from '../src/lib/types';
import spots from '../data/spots.json';

const SF = { lat: 37.7749, lon: -122.4194 };
const mk = (id: string, lat: number, lon: number): Spot => ({ id, name: id, lat, lon });

describe('geo', () => {
  it('computes distances', () => {
    // SF to LA is ~559 km.
    expect(distanceKm(SF, { lat: 34.0522, lon: -118.2437 })).toBeGreaterThan(550);
    expect(distanceKm(SF, { lat: 34.0522, lon: -118.2437 })).toBeLessThan(570);
    expect(distanceKm(SF, SF)).toBe(0);
  });
  it('computes bearings', () => {
    expect(bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 5);
    expect(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 5);
  });
});

describe('spot search', () => {
  const list = [mk('a', 37.8, -122.46), mk('b', 38.04, -121.8), mk('c', 45.7, -121.5), mk('d', 37.78, -122.42)];
  it('finds spots within radius sorted by distance', () => {
    const r = nearbySpots(list, SF, 50);
    expect(r.map((x) => x.spot.id)).toEqual(['d', 'a']);
    expect(nearbySpots(list, SF, 100).map((x) => x.spot.id)).toEqual(['d', 'a', 'b']);
  });
  it('limits results', () => {
    expect(nearbySpots(list, SF, 2000, 2)).toHaveLength(2);
  });
  it('handles the antimeridian', () => {
    const fiji = [mk('w', -17, 179.9), mk('e', -17, -179.9)];
    expect(nearbySpots(fiji, { lat: -17, lon: 179.95 }, 50)).toHaveLength(2);
  });
  it('returns nearest spots regardless of radius', () => {
    expect(nearestSpots(list, { lat: 0, lon: 0 }, 1)).toHaveLength(1);
  });
  it('dedupes merged spots', () => {
    const merged = mergeSpots(list, [mk('a-dup', 37.8001, -122.4601), mk('new', 40, -120)]);
    expect(merged.map((s) => s.id)).toContain('new');
    expect(merged.map((s) => s.id)).not.toContain('a-dup');
  });
});

describe('dataset', () => {
  it('is valid', () => {
    const ids = new Set<string>();
    for (const s of spots as Spot[]) {
      expect(ids.has(s.id), `duplicate id ${s.id}`).toBe(false);
      ids.add(s.id);
      expect(s.lat).toBeGreaterThanOrEqual(-90);
      expect(s.lat).toBeLessThanOrEqual(90);
      expect(s.lon).toBeGreaterThanOrEqual(-180);
      expect(s.lon).toBeLessThanOrEqual(180);
      for (const [a, b] of s.sectors ?? []) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(360);
        expect(b).toBeLessThanOrEqual(360);
      }
    }
  });
});

describe('curated dataset proximity', () => {
  // Distinct launches that are deliberately closer than the 1.5 km merge radius.
  const KNOWN_CLOSE = new Set([
    'hood-river-event-site|hood-river-hook',
    'hood-river-event-site|hood-river-sandbar',
    'kanaha|kite-beach-maui',
    'avon-soundside|avon-oceanside',
    'hvide-sande-north-sea|hvide-sande-fjord',
    'bloubergstrand|big-bay',
  ]);
  it('has no unlisted pair of spots within 1.5 km', () => {
    const list = spots as Spot[];
    const close: string[] = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (distanceKm(list[i], list[j]) < 1.5 && !KNOWN_CLOSE.has(`${list[i].id}|${list[j].id}`) && !KNOWN_CLOSE.has(`${list[j].id}|${list[i].id}`))
          close.push(`${list[i].id}|${list[j].id}`);
    expect(close).toEqual([]);
  });
});
