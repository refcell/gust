import { describe, expect, it, vi } from 'vitest';
import { nearestShorePoint, type ShoreFeature } from '../src/lib/coastline';
import type { CuratedSpot } from '../scripts/sector-suggest';
import {
  applyPositions,
  checkAll,
  checkFor,
  mergeChecks,
  proposePositions,
  selectPending,
  summarize,
  type PositionProposal,
  type ShoreCheck,
} from '../scripts/shore-positions';

const spot = (id: string, lat = 0, lon = 0): CuratedSpot => ({ id, name: id.toUpperCase(), lat, lon, sectors: [[0, 90]], notes: 'Note.' });
// Coastline running north along lon 0.002 (~223 m east of a spot at 0,0).
const coast: ShoreFeature = { kind: 'coastline', points: [{ lat: -0.01, lon: 0.002 }, { lat: 0.01, lon: 0.002 }] };
const overpassJson = { elements: [{ type: 'way', id: 1, tags: { natural: 'coastline' }, geometry: coast.points }] };
const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: vi.fn(async (ms: number) => void (t += ms)) };
}

describe('nearestShorePoint', () => {
  it('returns the closest point on the nearest segment, any kind', () => {
    const n = nearestShorePoint({ lat: 0, lon: 0 }, [coast]);
    expect(n!.kind).toBe('coastline');
    expect(n!.point.lat).toBeCloseTo(0, 9);
    expect(n!.point.lon).toBeCloseTo(0.002, 9);
    expect(n!.distanceKm).toBeCloseTo(0.2226, 3);
    expect(nearestShorePoint({ lat: 0, lon: 0 }, [{ ...coast, kind: 'river' }])!.kind).toBe('river');
    expect(nearestShorePoint({ lat: 0, lon: 0 }, [])).toBeNull();
  });
  it('clamps to segment ends, has no range cap, and skips small ponds', () => {
    const far: ShoreFeature = { kind: 'coastline', points: [{ lat: 0.05, lon: 0.05 }, { lat: 0.06, lon: 0.05 }] };
    const n = nearestShorePoint({ lat: 0, lon: 0 }, [far]);
    expect(n!.point).toEqual({ lat: expect.closeTo(0.05, 9), lon: expect.closeTo(0.05, 9) });
    expect(n!.distanceKm).toBeGreaterThan(7);
    // ~100 m square pond right next to the spot is ignored; the coast is nearest.
    const d = 0.0005;
    const pond: ShoreFeature = { kind: 'water', points: [{ lat: 0, lon: d }, { lat: 0, lon: 2 * d }, { lat: d, lon: 2 * d }, { lat: d, lon: d }, { lat: 0, lon: d }] };
    expect(nearestShorePoint({ lat: 0, lon: 0 }, [pond, coast])!.kind).toBe('coastline');
  });
  it('wraps longitude across the antimeridian', () => {
    const c: ShoreFeature = { kind: 'coastline', points: [{ lat: -0.01, lon: -179.999 }, { lat: 0.01, lon: -179.999 }] };
    expect(nearestShorePoint({ lat: 0, lon: 179.999 }, [c])!.point.lon).toBeCloseTo(-179.999, 6);
  });
});

describe('checkFor', () => {
  it('rounds the nearest point to 5 decimals and labels failures', () => {
    expect(checkFor(spot('a'), [coast])).toEqual({ id: 'a', lat: 0, lon: 0, distanceM: 223, shoreKind: 'coastline', nearestLat: 0, nearestLon: 0.002 });
    expect(checkFor(spot('a'), null)).toEqual({ id: 'a', lat: 0, lon: 0, reason: 'overpass-request-failed' });
    expect(checkFor(spot('a'), [])).toEqual({ id: 'a', lat: 0, lon: 0, reason: 'no-shore-within-range' });
  });
});

const measured = (id: string, distanceM: number, lat = 0): ShoreCheck => ({ id, lat, lon: 0, distanceM, shoreKind: 'coastline', nearestLat: lat + 0.001, nearestLon: 0.002 });
const failed = (id: string, reason = 'overpass-request-failed', lat = 0): ShoreCheck => ({ id, lat, lon: 0, reason });

describe('selectPending / mergeChecks', () => {
  const spots = [spot('a'), spot('b'), spot('c'), spot('d', 1), spot('e')];
  const prev = [measured('a', 10), failed('b'), failed('c', 'no-shore-within-range'), measured('d', 10)];
  it('skips spots done at their coordinates, retries failures and moved spots', () => {
    expect(selectPending(spots, prev).map((s) => s.id)).toEqual(['b', 'd', 'e']);
    expect(selectPending(spots, prev, { only: ['a', 'e'] }).map((s) => s.id)).toEqual(['e']);
    expect(selectPending(spots, prev, { limit: 2 }).map((s) => s.id)).toEqual(['b', 'd']);
    expect(selectPending(spots, prev, { limit: 0 })).toEqual([]);
  });
  it('merges in spot order, drops removed ids, never downgrades a completed check', () => {
    const out = mergeChecks(spots, [...prev, measured('gone', 5)], [failed('a'), measured('b', 20), failed('d', 'overpass-request-failed', 1)]);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(out[0]).toEqual(prev[0]);
    expect(out[1]).toEqual(measured('b', 20));
    expect(out[3]).toEqual(failed('d', 'overpass-request-failed', 1)); // moved: old check is stale
  });
});

describe('summarize', () => {
  it('counts and lists far and no-shore spots, farthest first', () => {
    const lines = summarize([measured('a', 100), measured('b', 400), measured('c', 2000), failed('d', 'no-shore-within-range'), failed('e')], 6);
    expect(lines[0]).toBe('5/6 spots checked: 3 measured (coastline 3), 1 no shore in range, 1 Overpass failure');
    expect(lines.slice(1)).toEqual([
      '2 farther than 300 m from any shore:',
      '  c: 2000 m (coastline) nearest 0.001,0.002',
      '  b: 400 m (coastline) nearest 0.001,0.002',
      '1 with no shore in range:',
      '  d',
    ]);
  });
});

describe('proposePositions', () => {
  const spots = [spot('a'), spot('b'), spot('c'), spot('d'), spot('e', 1), spot('f')];
  const checks = [measured('a', 150), measured('b', 151), measured('c', 3000), measured('d', 3001), measured('e', 500), measured('f', 800)];
  it('proposes the nearest shore point for (150, 3000] m at current coordinates, keeping reviews', () => {
    const old: PositionProposal = { id: 'f', name: 'F', lat: 0, lon: 0, distanceM: 700, shoreKind: 'coastline', proposedLat: 0.5, proposedLon: 0.5, review: 'rejected' };
    const out = proposePositions(spots, checks, [old]);
    expect(out.map((p) => p.id)).toEqual(['b', 'c', 'f']);
    expect(out[0]).toEqual({ id: 'b', name: 'B', lat: 0, lon: 0, distanceM: 151, shoreKind: 'coastline', proposedLat: 0.001, proposedLon: 0.002 });
    expect(out[0].review).toBeUndefined();
    expect(out[2]).toEqual({ ...old, distanceM: 800 });
  });
});

describe('applyPositions', () => {
  const p = (id: string, extra: Partial<PositionProposal> = {}): PositionProposal => ({
    id, name: id, lat: 0, lon: 0, distanceM: 400, shoreKind: 'coastline', proposedLat: 0.001, proposedLon: 0.002, review: 'approved', ...extra,
  });
  it('moves only approved proposals whose coordinates still match; nothing else changes', () => {
    const spots = [spot('a'), spot('b'), spot('c', 1), spot('d'), spot('e')];
    const r = applyPositions(spots, [p('a'), p('b', { review: 'rejected' }), p('c'), p('d', { review: undefined }), p('e', { proposedLat: Number.NaN }), p('zz')]);
    expect(r.applied).toEqual(['a']);
    expect(r.spots[0]).toEqual({ ...spots[0], lat: 0.001, lon: 0.002 });
    expect(r.spots.slice(1)).toEqual(spots.slice(1));
    expect(r.skipped).toEqual(['c (spot moved since the proposal)', 'e (invalid proposed coordinates)', 'zz (no such spot)']);
    expect(spots[0].lat).toBe(0); // input untouched
  });
});

describe('checkAll', () => {
  it('queries every spot through the sector-inference Overpass path and reports progress', async () => {
    const clock = fakeClock();
    let n = 0;
    const fetch = vi.fn(async () => res(200, n++ === 0 ? overpassJson : { elements: [] }));
    const onCheck = vi.fn();
    const out = await checkAll([spot('a'), spot('b', 10, 10)], { fetch, ...clock, onCheck });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(clock.sleep).toHaveBeenCalledWith(5000);
    expect(out).toEqual([checkFor(spot('a'), [coast]), { id: 'b', lat: 10, lon: 10, reason: 'no-shore-within-range' }]);
    expect(onCheck).toHaveBeenCalledTimes(2);
  });
  it('records failed requests after backoff', async () => {
    const fetch = vi.fn(async () => res(504));
    const out = await checkAll([spot('a')], { fetch, ...fakeClock(), backoffMs: [1000] });
    expect(out).toEqual([failed('a')]);
  });
});

describe('applyPositions near-duplicate guard', () => {
  it('skips a move that lands within 1.5 km of another spot', async () => {
    const { applyPositions } = await import('../scripts/shore-positions');
    const a = { id: 'a', name: 'A', lat: 0, lon: 0, sectors: [] };
    const b = { id: 'b', name: 'B', lat: 0, lon: 0.03, sectors: [] }; // ~3.3 km east
    const r = applyPositions([a, b], [{ id: 'a', lat: 0, lon: 0, proposedLat: 0, proposedLon: 0.025, review: 'approved' } as never]);
    expect(r.applied).toEqual([]);
    expect(r.skipped[0]).toMatch(/within 1.5 km of b/);
  });
});
