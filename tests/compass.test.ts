import { describe, expect, it } from 'vitest';
import { arrowClass, arrowTransform, compassLabel, compassSectorPaths, isFullCircle, polarToXY, sectorArcPath, sectorSpan } from '../src/lib/compass';

describe('compass geometry', () => {
  it('maps bearings with 0° = north, clockwise', () => {
    expect(polarToXY(0, 10)).toEqual({ x: 0, y: -10 });
    expect(polarToXY(90, 10)).toEqual({ x: 10, y: 0 });
    expect(polarToXY(180, 10)).toEqual({ x: 0, y: 10 });
    expect(polarToXY(270, 10)).toEqual({ x: -10, y: 0 });
    expect(polarToXY(-90, 10)).toEqual({ x: -10, y: 0 });
    expect(polarToXY(450, 10, 50, 50)).toEqual({ x: 60, y: 50 });
  });

  it('computes clockwise spans, including wrap-around and full circle', () => {
    expect(sectorSpan([270, 337.5])).toBe(67.5);
    expect(sectorSpan([300, 30])).toBe(90);
    expect(sectorSpan([0, 360])).toBe(360);
    expect(isFullCircle([0, 360])).toBe(true);
    expect(isFullCircle([10, 350])).toBe(false);
  });

  it('draws a small wedge', () => {
    expect(sectorArcPath(0, 90, 10)).toBe('M0 0L0 -10A10 10 0 0 1 10 0Z');
  });

  it('wraps past north', () => {
    expect(sectorArcPath(270, 90, 10)).toBe('M0 0L-10 0A10 10 0 0 1 10 0Z');
  });

  it('uses the large-arc flag for spans over 180°', () => {
    expect(sectorArcPath(90, 0, 10)).toBe('M0 0L10 0A10 10 0 1 1 0 -10Z');
    expect(sectorArcPath(10, 350, 10, 50, 50)).toContain(' 0 1 1 ');
  });

  it('draws a full circle as two arcs', () => {
    expect(sectorArcPath(0, 360, 10, 50, 50)).toBe('M50 40A10 10 0 1 1 50 60A10 10 0 1 1 50 40Z');
  });

  it('returns an empty path for an empty span', () => {
    expect(sectorArcPath(45, 45, 10)).toBe('');
  });
});

describe('compass rendering helpers', () => {
  it('rotates the downwind arrow by the wind direction', () => {
    expect(arrowTransform(0)).toBe('rotate(0)');
    expect(arrowTransform(90)).toBe('rotate(90)');
    expect(arrowTransform(89.6)).toBe('rotate(90)');
  });

  it('hides the arrow for missing or non-finite wind', () => {
    expect(arrowTransform(undefined)).toBeNull();
    expect(arrowTransform(NaN)).toBeNull();
    expect(arrowTransform(Infinity)).toBeNull();
  });

  it('colours the arrow by rating', () => {
    expect(arrowClass('good')).toBe('compass-arrow b-good');
    expect(arrowClass('offshore')).toBe('compass-arrow b-offshore');
    expect(arrowClass(undefined)).toBe('compass-arrow b-none');
  });

  it('draws one path per non-empty sector', () => {
    expect(compassSectorPaths([[225, 315], [45, 90], [300, 30]], 40)).toHaveLength(3);
    expect(compassSectorPaths([[90, 90]], 40)).toHaveLength(0);
    expect(compassSectorPaths([], 40)).toHaveLength(0);
  });

  it('labels the compass with the same wording as the Rideable from row', () => {
    expect(compassLabel([[225, 315], [45, 90]], 270)).toBe('Wind from W (270°); rideable from SW–NW, NE–E');
    expect(compassLabel([[300, 40]])).toBe('Rideable from WNW–NE');
    expect(compassLabel([[10, 350]], 0)).toBe('Wind from N (0°); rideable from 10° to 350° clockwise');
    expect(compassLabel([[0, 360]])).toBe('Rideable from any direction');
    expect(compassLabel([], NaN)).toBe('Rideable directions unknown');
  });
});
