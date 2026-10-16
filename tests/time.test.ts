import { describe, expect, it } from 'vitest';
import { hoursFrom } from '../src/lib/forecast';
import { epochToLocalIso, forecastClock, localIsoToEpoch, STALE_AFTER_MS } from '../src/lib/time';

const OFF = -25200; // UTC-7

describe('epochToLocalIso', () => {
  it('inverts localIsoToEpoch at a fixed offset', () => {
    const ms = localIsoToEpoch('2026-06-01T14:00', OFF);
    expect(ms).toBe(Date.parse('2026-06-01T21:00:00Z'));
    expect(epochToLocalIso(ms, OFF)).toBe('2026-06-01T14:00');
    expect(epochToLocalIso(Date.parse('2026-06-02T03:30:00Z'), OFF)).toBe('2026-06-01T20:30');
  });
});

describe('forecastClock', () => {
  const sample = '2026-06-01T09:00';
  const w = { current: { time: sample }, utcOffsetSeconds: OFF, observedAt: localIsoToEpoch(sample, OFF) };
  it('uses the sample time when fresh', () => {
    expect(forecastClock(w, w.observedAt + 30 * 60_000)).toEqual({ nowIso: sample, stale: false });
  });
  it('uses the wall clock in spot time when stale', () => {
    const now = w.observedAt + STALE_AFTER_MS + 5 * 3600_000;
    expect(forecastClock(w, now)).toEqual({ nowIso: '2026-06-01T15:30', stale: true });
  });
  it('never goes earlier than the sample (unknown observedAt)', () => {
    expect(forecastClock({ ...w, observedAt: NaN }, w.observedAt - 3600_000)).toEqual({ nowIso: sample, stale: true });
  });
});

describe('hoursFrom', () => {
  const hourly = Array.from({ length: 6 }, (_, i) => ({ time: `2026-06-01T${String(10 + i).padStart(2, '0')}:00` }));
  it('starts at the hour containing now', () => {
    expect(hoursFrom(hourly, '2026-06-01T12:45', 2).map((h) => h.time)).toEqual(['2026-06-01T12:00', '2026-06-01T13:00']);
    expect(hoursFrom(hourly, '2026-06-01T08:00')).toHaveLength(6);
  });
  it('is empty when every hour is past', () => {
    expect(hoursFrom(hourly, '2026-06-01T16:00')).toEqual([]);
  });
});
