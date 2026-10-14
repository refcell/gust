import { describe, expect, it } from 'vitest';
import { assembleRings, inferShore, sectorsFromNormal, type ShoreFeature } from '../src/lib/coastline';
import { inSector } from '../src/lib/sectors';

const spot = { lat: 30, lon: -80 };
/** Offset `spot` by metres (approximately). */
const at = (northM: number, eastM: number) => ({
  lat: spot.lat + northM / 111_320,
  lon: spot.lon + eastM / (111_320 * Math.cos((spot.lat * Math.PI) / 180)),
});

const coast = (...pts: { lat: number; lon: number }[]): ShoreFeature => ({ kind: 'coastline', points: pts });

describe('sectorsFromNormal', () => {
  it('spans normal ± 100 and wraps', () => {
    expect(sectorsFromNormal(90)).toEqual([[350, 190]]);
    expect(sectorsFromNormal(0)).toEqual([[260, 100]]);
    expect(sectorsFromNormal(270)).toEqual([[170, 10]]);
  });
});

describe('inferShore', () => {
  it('north-south coastline with water to the east faces east', () => {
    // Travelling north: land on the left (west), water on the right (east).
    const r = inferShore(spot, [coast(at(-2000, 200), at(2000, 200))]);
    expect(r).not.toBeNull();
    expect(r!.normalDeg).toBeCloseTo(90, 3);
    expect(r!.sectors).toEqual([[350, 190]]);
    expect(r!.distanceKm).toBeCloseTo(0.2, 2);
    expect(inSector(90, r!.sectors[0])).toBe(true); // onshore
    expect(inSector(0, r!.sectors[0])).toBe(true); // side-shore
    expect(inSector(270, r!.sectors[0])).toBe(false); // offshore
  });

  it('reversed way order flips the normal', () => {
    const r = inferShore(spot, [coast(at(2000, -300), at(-2000, -300))]);
    expect(r!.normalDeg).toBeCloseTo(270, 3);
  });

  it('east-west coastline travelling west faces north', () => {
    // Travelling west, the right-hand side is north.
    const r = inferShore(spot, [coast(at(500, 3000), at(500, -3000))]);
    expect(r!.normalDeg).toBeCloseTo(0, 3);
    expect(r!.sectors).toEqual([[260, 100]]);
  });

  it('uses the nearest segment of a bent coastline', () => {
    // Land corner: runs east (water south), then turns north (water east).
    const way = coast(at(-100, -3000), at(-100, 100), at(3000, 100));
    expect(inferShore(spot, [way])).not.toBeNull();
    expect(inferShore(at(-60, -2000), [way])!.normalDeg).toBeCloseTo(180, 3);
    expect(inferShore(at(2000, 50), [way])!.normalDeg).toBeCloseTo(90, 3);
  });

  it('picks the nearest of several features', () => {
    const r = inferShore(spot, [coast(at(-2000, 1000), at(2000, 1000)), coast(at(2000, -300), at(-2000, -300))]);
    expect(r!.normalDeg).toBeCloseTo(270, 3);
  });

  it('returns null when the shore is farther than 1.5 km or there is no geometry', () => {
    expect(inferShore(spot, [coast(at(2000, 1600), at(-2000, 1600))])).toBeNull();
    expect(inferShore(spot, [])).toBeNull();
    expect(inferShore(spot, [coast(at(0, 100))])).toBeNull();
  });

  it('closed water polygons face their interior regardless of winding', () => {
    // A 2 km x 2 km lake whose west shore is 300 m east of the spot.
    const ring = [at(-1000, 300), at(-1000, 2300), at(1000, 2300), at(1000, 300), at(-1000, 300)]; // CCW
    const ccw = inferShore(spot, [{ kind: 'water', points: ring }]);
    expect(ccw!.normalDeg).toBeCloseTo(90, 3);
    const cw = inferShore(spot, [{ kind: 'water', points: [...ring].reverse() }]);
    expect(cw!.normalDeg).toBeCloseTo(90, 3);
  });

  it('ignores ponds and open water ways', () => {
    const pond = [at(-100, 300), at(-100, 500), at(100, 500), at(100, 300), at(-100, 300)];
    expect(inferShore(spot, [{ kind: 'water', points: pond }])).toBeNull();
    expect(inferShore(spot, [{ kind: 'water', points: [at(-1000, 300), at(1000, 300)] }])).toBeNull();
  });

  it('multipolygon outer rings assembled from fragments face the lake interior', () => {
    const [a, b, c, d] = [at(-1000, 300), at(-1000, 2300), at(1000, 2300), at(1000, 300)];
    const rings = assembleRings([
      [a, b],
      [c, b],
      [c, d, a],
    ]);
    expect(rings).toHaveLength(1);
    expect(inferShore(spot, rings.map((points) => ({ kind: 'water' as const, points })))!.normalDeg).toBeCloseTo(90, 3);
    expect(assembleRings([[a, b], [c, d]])).toEqual([]);
  });

  it('treats a nearest river polygon as unknown, but not a farther one', () => {
    const river: ShoreFeature = { kind: 'river', points: [at(200, -3000), at(200, 3000)] };
    const sea = coast(at(-500, -3000), at(-500, 3000)); // travelling east: water south
    expect(inferShore(spot, [river, sea])).toBeNull();
    const farRiver: ShoreFeature = { kind: 'river', points: [at(1000, -3000), at(1000, 3000)] };
    expect(inferShore(spot, [farRiver, sea])!.normalDeg).toBeCloseTo(180, 3);
  });
});
