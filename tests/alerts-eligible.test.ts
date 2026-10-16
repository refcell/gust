import { describe, expect, it } from 'vitest';
import { alertEligible, computeAlerts, spotsOn } from '../src/lib/alerts';
import { STALE_AFTER_MS } from '../src/lib/time';
import { DEFAULT_SETTINGS, type Spot, type SpotWind } from '../src/lib/types';

const NOW = Date.parse('2025-06-01T12:10:00Z');
const spot = (id: string): Spot => ({ id, name: `Spot ${id}`, lat: 10, lon: 20, sectors: [[225, 300]] }) as Spot;
/** 20 kn W: good at a west-facing spot. */
const good = (observedAt = NOW - 10 * 60_000): SpotWind =>
  ({ current: { time: '2025-06-01T12:00', speedKn: 20, gustKn: 25, dirDeg: 270 }, hourly: [], utcOffsetSeconds: 0, fetchedAt: observedAt, observedAt }) as SpotWind;

describe('alert eligibility (shared by computeAlerts and the enable-alerts confirmation)', () => {
  const settings = { ...DEFAULT_SETTINGS, muted: ['m'] };
  const watched = [spot('fresh'), spot('stale'), spot('m'), spot('none')];
  const wind = { fresh: good(), stale: good(NOW - STALE_AFTER_MS - 60_000), m: good() };

  it('alertEligible rejects muted and stale samples', () => {
    expect(alertEligible(spot('fresh'), wind.fresh, settings, NOW)).toBe(true);
    expect(alertEligible(spot('stale'), wind.stale, settings, NOW)).toBe(false);
    expect(alertEligible(spot('m'), wind.m, settings, NOW)).toBe(false);
  });

  it('spotsOn lists only good spots that would alert', () => {
    expect(spotsOn(watched, wind, settings, NOW).map((x) => x.spot.id)).toEqual(['fresh']);
  });

  it('agrees with computeAlerts', () => {
    const entries = watched.filter((s) => s.id in wind).map((s) => ({ spot: s, wind: wind[s.id as keyof typeof wind] }));
    const { alerts } = computeAlerts(entries, { ratings: { fresh: 'light', stale: 'light', m: 'light' }, notifiedWindows: {} }, settings, { now: NOW });
    expect(alerts.map((a) => a.spotId)).toEqual(['fresh']);
  });
});
