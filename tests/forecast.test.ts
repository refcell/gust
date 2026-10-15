import { describe, expect, it } from 'vitest';
import { goodWindows, relativeDay } from '../src/lib/forecast';
import { computeAlerts, EMPTY_ALERT_STATE } from '../src/lib/alerts';
import { forecastUrl, parseLocation } from '../src/lib/openmeteo';
import { DEFAULT_SETTINGS, type Spot, type SpotWind, type WindSample } from '../src/lib/types';

const W = (time: string, speedKn: number, dirDeg = 270, gustKn = speedKn + 4): WindSample => ({ time, speedKn, gustKn, dirDeg });
const spot: Spot = { id: 'x', name: 'Test Beach', lat: 0, lon: 0, sectors: [[225, 315]] };

describe('goodWindows', () => {
  const hourly = [W('2026-06-01T10:00', 10), W('2026-06-01T11:00', 18), W('2026-06-01T12:00', 20), W('2026-06-01T13:00', 22), W('2026-06-01T14:00', 12), W('2026-06-01T15:00', 20)];
  it('finds runs of good hours', () => {
    const w = goodWindows(hourly, spot.sectors, DEFAULT_SETTINGS);
    expect(w).toHaveLength(1);
    expect(w[0].start).toBe('2026-06-01T11:00');
    expect(w[0].hours).toBe(3);
    expect(w[0].avgKn).toBe(20);
  });
  it('honors minimum length and start time', () => {
    expect(goodWindows(hourly, spot.sectors, { ...DEFAULT_SETTINGS, minWindowHours: 4 })).toHaveLength(0);
    expect(goodWindows(hourly, spot.sectors, { ...DEFAULT_SETTINGS, minWindowHours: 1 }, '2026-06-01T14:00')).toHaveLength(1);
  });
  it('breaks runs across missing hours', () => {
    const gappy = [W('2026-06-01T10:00', 20), W('2026-06-01T12:00', 20)];
    expect(goodWindows(gappy, spot.sectors, DEFAULT_SETTINGS)).toHaveLength(0);
  });
  it('ignores offshore hours', () => {
    expect(goodWindows(hourly.map((h) => ({ ...h, dirDeg: 90 })), spot.sectors, DEFAULT_SETTINGS)).toHaveLength(0);
  });
});

describe('relativeDay', () => {
  it('labels days', () => {
    expect(relativeDay('2026-06-01T14:00', '2026-06-01T09:15')).toBe('Today 14:00');
    expect(relativeDay('2026-06-02T09:00', '2026-06-01T09:15')).toBe('Tomorrow 09:00');
    expect(relativeDay('2026-06-04T09:00', '2026-06-01T09:15')).toBe('Thu 09:00');
  });
});

describe('computeAlerts', () => {
  const now = Date.parse('2026-06-01T09:00:00Z');
  const wind = (speed: number, hourly: WindSample[] = []): SpotWind => ({ current: W('2026-06-01T09:00', speed), hourly, utcOffsetSeconds: 0, fetchedAt: now, observedAt: now });

  it('ignores stale data entirely', () => {
    const light = computeAlerts([{ spot, wind: wind(8) }], EMPTY_ALERT_STATE, DEFAULT_SETTINGS, { now });
    const later = now + 3 * 86400_000;
    const r = computeAlerts([{ spot, wind: wind(20, [W('2026-06-01T14:00', 20), W('2026-06-01T15:00', 21)]) }], light.next, DEFAULT_SETTINGS, { now: later });
    expect(r.alerts).toHaveLength(0);
    expect(r.next.ratings.x).toBe(light.next.ratings.x);
  });
  it('never alerts for windows that already started', () => {
    const hourly = [W('2026-06-01T08:00', 20), W('2026-06-01T09:00', 20), W('2026-06-01T10:00', 21)];
    const r = computeAlerts([{ spot, wind: { ...wind(8, hourly), current: W('2026-06-01T07:00', 8) } }], EMPTY_ALERT_STATE, DEFAULT_SETTINGS, { now: now + 30 * 60_000 });
    expect(r.alerts.filter((a) => a.kind === 'forecast')).toHaveLength(0);
  });

  it('fires when a spot crosses into good, not on first sight', () => {
    const first = computeAlerts([{ spot, wind: wind(20) }], EMPTY_ALERT_STATE, DEFAULT_SETTINGS, { now });
    expect(first.alerts).toHaveLength(0);
    const light = computeAlerts([{ spot, wind: wind(8) }], EMPTY_ALERT_STATE, DEFAULT_SETTINGS, { now });
    const on = computeAlerts([{ spot, wind: wind(20) }], light.next, DEFAULT_SETTINGS, { now });
    expect(on.alerts).toHaveLength(1);
    expect(on.alerts[0].title).toBe('Test Beach is on');
    expect(on.alerts[0].body).toContain('20 kn');
    // Still good: no repeat.
    expect(computeAlerts([{ spot, wind: wind(21) }], on.next, DEFAULT_SETTINGS, { now }).alerts).toHaveLength(0);
  });
  it('never alerts for muted spots', () => {
    const light = computeAlerts([{ spot, wind: wind(8) }], EMPTY_ALERT_STATE, DEFAULT_SETTINGS, { now });
    const muted = { ...DEFAULT_SETTINGS, muted: ['x'] };
    expect(computeAlerts([{ spot, wind: wind(20) }], light.next, muted, { now }).alerts).toHaveLength(0);
  });
  it('can alert on first sight', () => {
    expect(computeAlerts([{ spot, wind: wind(20) }], EMPTY_ALERT_STATE, DEFAULT_SETTINGS, { now, alertOnFirst: true }).alerts).toHaveLength(1);
  });
  it('fires one forecast alert per window', () => {
    const hourly = [W('2026-06-01T09:00', 8), W('2026-06-01T14:00', 20), W('2026-06-01T15:00', 21), W('2026-06-01T16:00', 8)];
    const a = computeAlerts([{ spot, wind: wind(8, hourly) }], EMPTY_ALERT_STATE, DEFAULT_SETTINGS, { now });
    expect(a.alerts.map((x) => x.kind)).toEqual(['forecast']);
    expect(a.alerts[0].body).toContain('Today 14:00');
    const b = computeAlerts([{ spot, wind: wind(8, hourly) }], a.next, DEFAULT_SETTINGS, { now });
    expect(b.alerts).toHaveLength(0);
  });
  it('does not re-alert when a forecast update shifts the same window by a few hours', () => {
    const at = (start: string, end: string) => [W('2026-06-01T09:00', 8), W(start, 20), W(end, 21), W('2026-06-01T22:00', 8)];
    const a = computeAlerts([{ spot, wind: wind(8, at('2026-06-01T14:00', '2026-06-01T15:00')) }], EMPTY_ALERT_STATE, DEFAULT_SETTINGS, { now });
    expect(a.alerts).toHaveLength(1);
    const shifted = computeAlerts([{ spot, wind: wind(8, at('2026-06-01T11:00', '2026-06-01T12:00')) }], a.next, DEFAULT_SETTINGS, { now });
    expect(shifted.alerts).toHaveLength(0);
    // A separate session (7 h after the first window) still alerts.
    const evening = [W('2026-06-01T09:00', 8), W('2026-06-01T21:00', 20), W('2026-06-01T22:00', 21), W('2026-06-01T23:00', 8)];
    const later = computeAlerts([{ spot, wind: wind(8, evening) }], a.next, DEFAULT_SETTINGS, { now });
    expect(later.alerts.map((x) => x.kind)).toEqual(['forecast']);
  });
  it('skips forecast windows beyond the horizon or when disabled', () => {
    const hourly = [W('2026-06-03T14:00', 20), W('2026-06-03T15:00', 21)];
    expect(computeAlerts([{ spot, wind: wind(8, hourly) }], EMPTY_ALERT_STATE, DEFAULT_SETTINGS, { now }).alerts).toHaveLength(0);
    const soon = [W('2026-06-01T14:00', 20), W('2026-06-01T15:00', 21)];
    expect(computeAlerts([{ spot, wind: wind(8, soon) }], EMPTY_ALERT_STATE, { ...DEFAULT_SETTINGS, forecastAlerts: false }, { now }).alerts).toHaveLength(0);
  });
});

describe('open-meteo', () => {
  it('builds a batched URL', () => {
    const u = new URL(forecastUrl([{ lat: 1, lon: 2 }, { lat: 3.123456, lon: -4 }]));
    expect(u.searchParams.get('latitude')).toBe('1.0000,3.1235');
    expect(u.searchParams.get('longitude')).toBe('2.0000,-4.0000');
    expect(u.searchParams.get('wind_speed_unit')).toBe('kn');
    expect(u.searchParams.get('current')).toContain('wind_gusts_10m');
  });
  it('parses a location and drops null hours', () => {
    const p = parseLocation({
      utc_offset_seconds: -25200,
      current: { time: '2026-06-01T09:00', wind_speed_10m: 12, wind_gusts_10m: 18, wind_direction_10m: 280 },
      hourly: { time: ['2026-06-01T09:00', '2026-06-01T10:00'], wind_speed_10m: [12, null], wind_gusts_10m: [18, 20], wind_direction_10m: [280, 285] },
    });
    expect(p?.current.speedKn).toBe(12);
    expect(p?.hourly).toHaveLength(1);
    expect(p?.utcOffsetSeconds).toBe(-25200);
    expect(p?.observedAt).toBe(Date.parse('2026-06-01T16:00:00Z'));
  });
  it('rejects invalid current data', () => {
    const base = { utc_offset_seconds: 0, hourly: { time: [], wind_speed_10m: [], wind_gusts_10m: [], wind_direction_10m: [] } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = (current: any) => parseLocation({ ...base, current } as any);
    expect(bad({ time: '2026-06-01T09:00', wind_speed_10m: 12, wind_gusts_10m: null, wind_direction_10m: 280 })).toBeNull();
    expect(bad({ time: '2026-06-01T09:00', wind_speed_10m: NaN, wind_gusts_10m: 3, wind_direction_10m: 280 })).toBeNull();
    expect(bad({ time: '2026-06-01T09:00', wind_speed_10m: 5, wind_gusts_10m: 3, wind_direction_10m: 400 })).toBeNull();
    expect(bad({ time: 'nope', wind_speed_10m: 5, wind_gusts_10m: 3, wind_direction_10m: 40 })).toBeNull();
  });
});
