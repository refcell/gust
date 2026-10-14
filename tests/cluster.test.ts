import { describe, expect, it } from 'vitest';
import { bestRating, clusterPoints } from '../src/lib/cluster';

const pt = (x: number, y: number, item: string) => ({ x, y, item });

describe('clusterPoints', () => {
  it('returns nothing for no points and singletons for spread points', () => {
    expect(clusterPoints([])).toEqual([]);
    const c = clusterPoints([pt(0, 0, 'a'), pt(100, 0, 'b'), pt(0, 100, 'c')]);
    expect(c.map((k) => k.items)).toEqual([['a'], ['b'], ['c']]);
    expect(c[1]).toMatchObject({ x: 100, y: 0 });
  });

  it('merges points within the radius into one cluster at their centroid', () => {
    const c = clusterPoints([pt(10, 10, 'a'), pt(30, 10, 'b'), pt(10, 40, 'c'), pt(200, 200, 'd')], 40);
    expect(c).toHaveLength(2);
    expect(c[0].items).toEqual(['a', 'b', 'c']);
    expect(c[0].x).toBeCloseTo(50 / 3);
    expect(c[0].y).toBeCloseTo(20);
    expect(c[1].items).toEqual(['d']);
  });

  it('is greedy from the seed: chains do not merge beyond the radius', () => {
    const c = clusterPoints([pt(0, 0, 'a'), pt(35, 0, 'b'), pt(70, 0, 'c')], 40);
    expect(c.map((k) => k.items)).toEqual([['a', 'b'], ['c']]);
  });

  it('finds neighbours across grid cell boundaries and negative coordinates', () => {
    const c = clusterPoints([pt(-1, -1, 'a'), pt(1, 1, 'b'), pt(39, 39, 'c')], 40);
    expect(c.map((k) => k.items)).toEqual([['a', 'b'], ['c']]);
    expect(clusterPoints([pt(79, 0, 'a'), pt(81, 0, 'b')], 40)[0].items).toEqual(['a', 'b']);
  });

  it('keeps every point exactly once and members in input order', () => {
    const pts = Array.from({ length: 200 }, (_, i) => pt((i * 37) % 300, (i * 53) % 300, String(i)));
    const c = clusterPoints(pts, 40);
    const all = c.flatMap((k) => k.items);
    expect(all.sort()).toEqual(pts.map((p) => p.item).sort());
    for (const k of c) expect(k.items).toEqual([...k.items].sort((a, b) => Number(a) - Number(b)));
  });

  it('splits as the scale grows (zooming in)', () => {
    const at = (scale: number) => clusterPoints([pt(0, 0, 'a'), pt(10 * scale, 0, 'b')], 40).length;
    expect(at(1)).toBe(1);
    expect(at(8)).toBe(2);
  });
});

describe('bestRating', () => {
  it('picks the most rideable rating; offshore ranks lowest', () => {
    expect(bestRating(['light', 'good', 'strong'])).toBe('good');
    expect(bestRating(['strong', 'ok'])).toBe('ok');
    expect(bestRating(['offshore', 'poor'])).toBe('poor');
    expect(bestRating(['offshore', null])).toBe('offshore');
    expect(bestRating([null, undefined])).toBeNull();
    expect(bestRating([])).toBeNull();
  });
});
