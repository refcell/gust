import { describe, expect, it } from 'vitest';
import { formatDistance, formatSpeed, fromKnots, toKnots } from '../src/lib/units';

describe('units', () => {
  it('converts knots', () => {
    expect(fromKnots(10, 'kn')).toBe(10);
    expect(fromKnots(10, 'mph')).toBeCloseTo(11.508, 2);
    expect(fromKnots(10, 'ms')).toBeCloseTo(5.144, 2);
    expect(fromKnots(10, 'kmh')).toBeCloseTo(18.52, 2);
  });
  it('round-trips', () => {
    for (const u of ['kn', 'mph', 'ms', 'kmh'] as const) expect(toKnots(fromKnots(23.4, u), u)).toBeCloseTo(23.4, 9);
  });
  it('formats', () => {
    expect(formatSpeed(15.4, 'kn')).toBe('15 kn');
    expect(formatSpeed(10, 'ms')).toBe('5.1 m/s');
    expect(formatSpeed(10, 'mph', false)).toBe('12');
    expect(formatSpeed(null, 'kn')).toBe('–');
    expect(formatSpeed(NaN, 'kn')).toBe('–');
  });
  it('formats distance', () => {
    expect(formatDistance(0.42)).toBe('420 m');
    expect(formatDistance(3.25)).toBe('3.3 km');
    expect(formatDistance(42.4)).toBe('42 km');
  });
});
