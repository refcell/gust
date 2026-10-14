import { describe, expect, it } from 'vitest';
import { clampZoom, fitBounds, fromPixel, metersPerPixel, normalize, project, toPixel, toTile, unproject, visibleTiles, worldSize, zoomAround, MAX_LAT } from '../src/lib/tiles';

describe('tile math', () => {
  it('projects the origin to the centre of the world', () => {
    expect(toPixel({ lat: 0, lon: 0 }, 0)).toEqual({ x: 128, y: 128 });
    expect(project({ lat: 0, lon: -180 }).x).toBe(0);
    expect(project({ lat: 0, lon: 180 }).x).toBe(1);
  });

  it('maps known coordinates to OSM tiles', () => {
    // San Francisco at z10 is tile 163/395 (standard slippy-map numbering).
    expect(toTile({ lat: 37.7749, lon: -122.4194 }, 10)).toEqual({ x: 163, y: 395 });
    // Sydney Opera House at z12.
    expect(toTile({ lat: -33.8568, lon: 151.2153 }, 12)).toEqual({ x: 3768, y: 2457 });
    expect(toTile({ lat: 0, lon: 0 }, 1)).toEqual({ x: 1, y: 1 });
  });

  it('clamps latitude to the mercator limit', () => {
    expect(project({ lat: 90, lon: 0 }).y).toBeCloseTo(0, 6);
    expect(project({ lat: -90, lon: 0 }).y).toBeCloseTo(1, 6);
    expect(unproject({ x: 0.5, y: 0 }).lat).toBeCloseTo(MAX_LAT, 6);
  });

  it('round-trips lat/lon through pixels', () => {
    for (const p of [
      { lat: 37.8, lon: -122.45 },
      { lat: -33.9, lon: 18.4 },
      { lat: 64.1, lon: -21.9 },
    ]) {
      for (const z of [3, 9.5, 15]) {
        const back = fromPixel(toPixel(p, z), z);
        expect(back.lat).toBeCloseTo(p.lat, 9);
        expect(back.lon).toBeCloseTo(p.lon, 9);
      }
    }
  });

  it('computes ground resolution', () => {
    expect(worldSize(2)).toBe(1024);
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metersPerPixel(60, 10)).toBeCloseTo(156543.03 / 1024 / 2, 1);
  });

  it('fits a radius box into the viewport', () => {
    const c = { lat: 37.8, lon: -122.45 };
    const d = 50 / 111.32;
    const dl = 50 / (111.32 * Math.cos((c.lat * Math.PI) / 180));
    const { center, zoom } = fitBounds([{ lat: c.lat + d, lon: c.lon - dl }, { lat: c.lat - d, lon: c.lon + dl }], 400, 600, 20);
    const back = unproject(center);
    expect(back.lon).toBeCloseTo(c.lon, 6);
    expect(back.lat).toBeCloseTo(c.lat, 1);
    // 100 km wide box in 360 px at ~38°N: ~0.22 km/px -> zoom ~ 8.5.
    expect(zoom).toBeGreaterThan(8);
    expect(zoom).toBeLessThan(9);
    const w = (project({ lat: c.lat, lon: c.lon + dl }).x - project({ lat: c.lat, lon: c.lon - dl }).x) * worldSize(zoom);
    expect(w).toBeCloseTo(360, 0);
  });

  it('clamps zoom to 3..15', () => {
    expect(clampZoom(1)).toBe(3);
    expect(clampZoom(20)).toBe(15);
    expect(fitBounds([{ lat: 1, lon: 1 }], 300, 300).zoom).toBe(15);
  });

  it('keeps the anchor point fixed when zooming', () => {
    const c = project({ lat: 37.8, lon: -122.45 });
    const next = zoomAround(c, 9, 11, 100, -50);
    const before = { x: c.x + 100 / worldSize(9), y: c.y - 50 / worldSize(9) };
    const after = { x: next.x + 100 / worldSize(11), y: next.y - 50 / worldSize(11) };
    expect(after.x).toBeCloseTo(before.x, 12);
    expect(after.y).toBeCloseTo(before.y, 12);
    expect(zoomAround(c, 9, 11, 0, 0)).toEqual(c);
  });

  it('wraps x and clamps y', () => {
    expect(normalize({ x: 1.25, y: 2 })).toEqual({ x: 0.25, y: 1 });
    expect(normalize({ x: -0.25, y: -1 }).x).toBeCloseTo(0.75);
  });

  it('lists tiles covering the viewport', () => {
    const tiles = visibleTiles({ x: 0.5, y: 0.5 }, 3, 512, 512);
    // 512 px centred on the world centre at z3 covers tiles 3..4 (plus edges).
    expect(tiles.every((t) => t.z === 3 && t.size === 256)).toBe(true);
    expect(tiles.map((t) => `${t.x}/${t.y}`).sort()).toEqual(['3/3', '3/4', '4/3', '4/4']);
    const first = tiles.find((t) => t.x === 3 && t.y === 3)!;
    expect([first.left, first.top]).toEqual([0, 0]);
    // Wraps across the antimeridian.
    const wrapped = visibleTiles({ x: 0, y: 0.5 }, 3, 256, 256);
    expect(wrapped.map((t) => t.x).sort()).toEqual([0, 0, 7, 7]);
    // Fractional zoom scales tiles.
    expect(visibleTiles({ x: 0.5, y: 0.5 }, 3.4, 256, 256)[0].size).toBe(Math.round(256 * 2 ** 0.4));
  });
});
