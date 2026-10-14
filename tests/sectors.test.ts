import { describe, expect, it } from 'vitest';
import { angleDiff, compass, describeSectors, distanceToSectors, inAnySector, inSector, normDeg } from '../src/lib/sectors';

describe('sectors', () => {
  it('normalizes degrees', () => {
    expect(normDeg(-10)).toBe(350);
    expect(normDeg(370)).toBe(10);
    expect(normDeg(360)).toBe(0);
  });
  it('computes angular difference', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(90, 90)).toBe(0);
  });
  it('handles plain sectors', () => {
    expect(inSector(270, [225, 315])).toBe(true);
    expect(inSector(225, [225, 315])).toBe(true);
    expect(inSector(315, [225, 315])).toBe(true);
    expect(inSector(200, [225, 315])).toBe(false);
  });
  it('handles sectors that wrap past north', () => {
    expect(inSector(350, [300, 30])).toBe(true);
    expect(inSector(0, [300, 30])).toBe(true);
    expect(inSector(20, [300, 30])).toBe(true);
    expect(inSector(90, [300, 30])).toBe(false);
    expect(inSector(-10, [300, 30])).toBe(true);
    expect(inSector(10, [300, 390])).toBe(true);
  });
  it('treats full-circle sectors as all directions', () => {
    expect(inSector(123, [0, 360])).toBe(true);
  });
  it('checks multiple sectors', () => {
    const s: [number, number][] = [
      [250, 290],
      [70, 110],
    ];
    expect(inAnySector(90, s)).toBe(true);
    expect(inAnySector(180, s)).toBe(false);
  });
  it('measures distance to sectors', () => {
    expect(distanceToSectors(270, [[225, 315]])).toBe(0);
    expect(distanceToSectors(320, [[225, 315]])).toBe(5);
    expect(distanceToSectors(90, [[225, 315]])).toBe(135);
    expect(distanceToSectors(90, [])).toBe(Infinity);
  });
  it('labels compass points', () => {
    expect(compass(0)).toBe('N');
    expect(compass(359)).toBe('N');
    expect(compass(22.5)).toBe('NNE');
    expect(compass(270)).toBe('W');
    expect(compass(-45)).toBe('NW');
    expect(describeSectors([[225, 315], [90, 90]])).toBe('SW–NW, E');
  });
});
