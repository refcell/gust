import { describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '../src/lib/overpass';
import { inferShoreDetailed, type ShoreFeature } from '../src/lib/coastline';
import {
  APPLY_NOTE,
  USER_AGENT,
  applySuggestions,
  formatSpots,
  inferAll,
  politeFetch,
  selectUnknown,
  suggestionFor,
  type CuratedSpot,
  type Suggestion,
} from '../scripts/sector-suggest';

const spot = (id: string, sectors: CuratedSpot['sectors'] = [], extra: Partial<CuratedSpot> = {}): CuratedSpot => ({
  id,
  name: id.toUpperCase(),
  lat: 0,
  lon: 0,
  sectors,
  notes: 'Note.',
  ...extra,
});

// Coastline running north along lon 0.002 (~220 m east of the spot): land left (west), sea east.
const coast: ShoreFeature = { kind: 'coastline', points: [{ lat: -0.01, lon: 0.002 }, { lat: 0.01, lon: 0.002 }] };
const overpassJson = { elements: [{ type: 'way', id: 1, tags: { natural: 'coastline' }, geometry: coast.points }] };

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: vi.fn(async (ms: number) => void (t += ms)) };
}

const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe('selectUnknown', () => {
  it('keeps spots with empty or missing sectors', () => {
    const s = [spot('a', [[0, 90]]), spot('b'), spot('c', undefined)];
    delete s[2].sectors;
    expect(selectUnknown(s).map((x) => x.id)).toEqual(['b', 'c']);
  });
});

describe('inferShoreDetailed', () => {
  it('reports the kind and why nothing was inferred', () => {
    const p = { lat: 0, lon: 0 };
    expect(inferShoreDetailed(p, [coast])).toMatchObject({ kind: 'coastline' });
    expect(inferShoreDetailed(p, [])).toEqual({ reason: 'no-shore-within-range' });
    expect(inferShoreDetailed(p, [{ ...coast, kind: 'river' }])).toEqual({ reason: 'nearest-shore-river' });
    expect(inferShoreDetailed(p, [{ ...coast, kind: 'ambiguous' }])).toEqual({ reason: 'nearest-shore-ambiguous' });
  });
});

describe('suggestionFor', () => {
  it('builds a rounded sea suggestion', () => {
    const s = suggestionFor(spot('a'), [coast]);
    expect(s).toMatchObject({ id: 'a', name: 'A', lat: 0, lon: 0, normalDeg: 90, sectors: [[0, 180]], shoreKind: 'sea' });
    expect('distanceM' in s && s.distanceM).toBeGreaterThan(200);
    expect('distanceM' in s && s.distanceM).toBeLessThan(240);
  });
  it('labels lake shores and unknowns', () => {
    // CCW square lake east of the spot (water inside).
    const lake: ShoreFeature = {
      kind: 'water',
      points: [
        { lat: -0.01, lon: 0.002 },
        { lat: -0.01, lon: 0.02 },
        { lat: 0.01, lon: 0.02 },
        { lat: 0.01, lon: 0.002 },
        { lat: -0.01, lon: 0.002 },
      ],
    };
    expect(suggestionFor(spot('a'), [lake])).toMatchObject({ shoreKind: 'lake', normalDeg: 90 });
    expect(suggestionFor(spot('a'), null)).toEqual({ id: 'a', reason: 'overpass-request-failed' });
    expect(suggestionFor(spot('a'), [])).toEqual({ id: 'a', reason: 'no-shore-within-range' });
  });
});

describe('applySuggestions', () => {
  const sugg: Suggestion[] = [
    { id: 'a', name: 'A', lat: 0, lon: 0, normalDeg: 90, sectors: [[0, 180]], shoreKind: 'sea', distanceM: 120, review: 'approved' },
    { id: 'b', name: 'B', lat: 0, lon: 0, normalDeg: 0, sectors: [[270, 90]], shoreKind: 'lake', distanceM: 500, review: 'approved' },
    { id: 'c', name: 'C', lat: 0, lon: 0, normalDeg: 0, sectors: [[270, 90]], shoreKind: 'sea', distanceM: 501, review: 'approved' },
    { id: 'd', reason: 'nearest-shore-river' },
    { id: 'e', name: 'E', lat: 0, lon: 0, normalDeg: 0, sectors: [[270, 90]], shoreKind: 'sea', distanceM: 10, review: 'approved' },
    { id: 'f', name: 'F', lat: 0, lon: 0, normalDeg: 0, sectors: [[270, 90]], shoreKind: 'sea', distanceM: 10, review: 'rejected' },
    { id: 'g', name: 'G', lat: 0, lon: 0, normalDeg: 0, sectors: [[270, 90]], shoreKind: 'sea', distanceM: 10 },
  ];
  it('applies only close sea/lake suggestions to still-unknown spots', () => {
    const spots = [spot('a'), spot('b', [], { notes: undefined }), spot('c'), spot('d'), spot('e', [[10, 20]]), spot('f')];
    const r = applySuggestions(spots, sugg);
    expect(r.applied).toEqual(['a', 'b']);
    expect(r.spots[0]).toEqual({ ...spots[0], sectors: [[0, 180]], notes: 'Note.' + APPLY_NOTE });
    expect(r.spots[1].notes).toBe(APPLY_NOTE.trim());
    expect(r.spots.slice(2)).toEqual(spots.slice(2));
    expect(spots[0].sectors).toEqual([]); // input untouched
  });
  it('skips unreviewed, rejected, moved spots and overlong notes', () => {
    const r = applySuggestions([spot('f'), spot('g'), { ...spot('a'), lat: 1 }, spot('b', [], { notes: 'x'.repeat(130) })], sugg);
    expect(r.applied).toEqual([]);
    expect(r.skipped).toEqual(['a (spot moved since inference)', 'b (notes would exceed 140 characters)']);
  });
  it('does not append the note twice', () => {
    const once = applySuggestions([spot('a')], sugg).spots;
    const twice = applySuggestions([{ ...once[0], sectors: [] }], sugg).spots;
    expect(twice[0].notes).toBe('Note.' + APPLY_NOTE);
  });
  it('formats one spot per line', () => {
    expect(formatSpots([{ a: 1 }, { b: 2 }])).toBe('[\n  {"a":1},\n  {"b":2}\n]\n');
  });
});

describe('politeFetch', () => {
  it('sets the User-Agent and spaces requests >= 5 s apart', async () => {
    const clock = fakeClock();
    const fetch = vi.fn(async () => res(200));
    const http = politeFetch({ fetch, ...clock });
    await http.fetch('u1');
    await http.fetch('u2');
    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenCalledWith(5000);
    const init = (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(new Headers(init.headers).get('user-agent')).toBe(USER_AGENT);
    expect(http.statuses).toEqual([200, 200]);
  });
});

describe('inferAll', () => {
  it('queries only unknown spots, one request each, in app endpoint order', async () => {
    const clock = fakeClock();
    const fetch = vi.fn(async () => res(200, overpassJson));
    const out = await inferAll([spot('a'), spot('known', [[0, 90]]), spot('b', [], { lat: 10, lon: 10 })], { fetch, ...clock });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual([ENDPOINTS[0], ENDPOINTS[0]]);
    const body = String(((fetch.mock.calls[0] as unknown[])[1] as RequestInit).body);
    expect(decodeURIComponent(body)).toContain('way["natural"="coastline"]');
    expect(out[0]).toMatchObject({ id: 'a', shoreKind: 'sea' });
    expect(out[1]).toEqual({ id: 'b', reason: 'no-shore-within-range' });
  });

  it('falls through endpoints and backs off on 429/504, then gives up', async () => {
    const clock = fakeClock();
    const fetch = vi.fn(async (url: RequestInfo | URL) => (url === ENDPOINTS[0] ? res(429) : res(504)));
    const out = await inferAll([spot('a')], { fetch, ...clock, backoffMs: [30_000] });
    expect(fetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual([...ENDPOINTS, ...ENDPOINTS]);
    expect(clock.sleep).toHaveBeenCalledWith(30_000);
    expect(out).toEqual([{ id: 'a', reason: 'overpass-request-failed' }]);
  });

  it('retries after a rate limit and succeeds; no retry on 400', async () => {
    const clock = fakeClock();
    let n = 0;
    const fetch = vi.fn(async () => (n++ < 2 ? res(429) : res(200, overpassJson)));
    expect((await inferAll([spot('a')], { fetch, ...clock, backoffMs: [1000] }))[0]).toMatchObject({ shoreKind: 'sea' });
    const bad = vi.fn(async () => res(400));
    expect(await inferAll([spot('a')], { fetch: bad, ...fakeClock() })).toEqual([{ id: 'a', reason: 'overpass-request-failed' }]);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});

describe('mergeResults', () => {
  it('lets new results replace old ones but never downgrades an inference to unknown', async () => {
    const { mergeResults } = await import('../scripts/sector-suggest');
    const known = { id: 'a', name: 'A', lat: 0, lon: 0, normalDeg: 90, sectors: [[0, 180]] as [number, number][], shoreKind: 'sea' as const, distanceM: 10 };
    const out = mergeResults([known, { id: 'b', reason: 'overpass-request-failed' }], [{ id: 'a', reason: 'overpass-request-failed' }, { ...known, id: 'b' }, { id: 'c', reason: 'x' }]);
    expect(out.map((s) => ('normalDeg' in s ? `${s.id}:known` : `${s.id}:unknown`))).toEqual(['a:known', 'b:known', 'c:unknown']);
  });
});
