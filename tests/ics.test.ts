import { describe, expect, it } from 'vitest';
import { buildIcs, calendarWindows, escapeText, eventUid, foldLine, icsDate, type CalendarWindow } from '../src/lib/ics';
import { localIsoToEpochInZone } from '../src/lib/time';
import { parseLocation } from '../src/lib/openmeteo';
import { DEFAULT_SETTINGS, type Spot, type SpotWind, type WindSample } from '../src/lib/types';

const enc = new TextEncoder();
const W = (time: string, speedKn: number, dirDeg = 270): WindSample => ({ time, speedKn, gustKn: speedKn + 4, dirDeg });
const spot: Spot = { id: 'test-beach', name: 'Test Beach, North; Bay', lat: 37.80512, lon: -122.46789, sectors: [[225, 315]] };

function windOf(hourly: WindSample[], utcOffsetSeconds: number, timezone?: string, current = hourly[0].time): SpotWind {
  const observedAt = localIsoToEpochInZone(current, timezone, utcOffsetSeconds);
  return { current: { ...hourly[0], time: current }, hourly, utcOffsetSeconds, timezone, fetchedAt: observedAt, observedAt };
}

const win: CalendarWindow = {
  spotId: 'test-beach',
  spotName: spot.name,
  lat: spot.lat,
  lon: spot.lon,
  startMs: Date.UTC(2026, 5, 1, 18),
  endMs: Date.UTC(2026, 5, 1, 21),
  avgKn: 21.4,
  maxKn: 23,
  maxGustKn: 27,
  dirDeg: 270,
};

describe('ics primitives', () => {
  it('formats UTC date-times', () => {
    expect(icsDate(Date.UTC(2026, 0, 2, 3, 4, 5, 678))).toBe('20260102T030405Z');
  });
  it('escapes commas, semicolons, backslashes and newlines', () => {
    expect(escapeText('a,b;c\\d\ne\r\nf')).toBe('a\\,b\\;c\\\\d\\ne\\nf');
  });
  it('folds at 75 octets without splitting UTF-8 characters', () => {
    expect(foldLine('x'.repeat(75))).toBe('x'.repeat(75));
    const long = 'DESCRIPTION:' + 'é°'.repeat(60) + 'abc'.repeat(30);
    const folded = foldLine(long);
    const phys = folded.split('\r\n');
    expect(phys.length).toBeGreaterThan(2);
    for (const [i, l] of phys.entries()) {
      expect(enc.encode(l).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(l.startsWith(' ')).toBe(true);
    }
    expect(phys.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(long);
  });
  it('UIDs are stable per spot and window start', () => {
    expect(eventUid('a', win.startMs)).toBe(eventUid('a', win.startMs));
    expect(eventUid('a', win.startMs)).not.toBe(eventUid('b', win.startMs));
    expect(eventUid('a', win.startMs)).not.toBe(eventUid('a', win.startMs + 3600_000));
  });
});

describe('buildIcs', () => {
  const now = Date.UTC(2026, 5, 1, 12, 30);
  const ics = buildIcs([win], { now });
  const unfolded = ics.replace(/\r\n /g, '');
  it('uses CRLF everywhere and folds every line', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const l of ics.split('\r\n')) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
  });
  it('writes one VEVENT with the required properties', () => {
    expect(unfolded.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(unfolded).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:/);
    expect(unfolded).toContain('SUMMARY:Wind on: Test Beach\\, North\\; Bay (21 kn)\r\n');
    expect(unfolded).toContain('DTSTART:20260601T180000Z\r\n');
    expect(unfolded).toContain('DTEND:20260601T210000Z\r\n');
    expect(unfolded).toContain('DTSTAMP:20260601T123000Z\r\n');
    expect(unfolded).toContain(`UID:${eventUid('test-beach', win.startMs)}\r\n`);
    expect(unfolded).toContain('LOCATION:37.80512\\,-122.46789\r\n');
    expect(unfolded).toContain('GEO:37.80512;-122.46789\r\n');
    expect(unfolded).toContain('DESCRIPTION:Average 21 kn\\, max 23 kn\\, gusts to 27 kn\\, from W (270°).\\n');
    expect(unfolded).toContain('https://refcell.github.io/gust/app/?spot=test-beach');
    expect(unfolded.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
  it('adds a 60 minute display alarm inside the event', () => {
    expect(unfolded).toMatch(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:[^\r]+\r\nTRIGGER:-PT60M\r\nEND:VALARM\r\nEND:VEVENT/);
  });
  it('uses the chosen unit', () => {
    expect(buildIcs([win], { now, unit: 'ms' }).replace(/\r\n /g, '')).toContain('(11.0 m/s)');
  });
  it('a later export keeps the UID and raises SEQUENCE', () => {
    const later = buildIcs([win], { now: now + 3600_000 }).replace(/\r\n /g, '');
    const seq = (s: string) => Number(/SEQUENCE:(\d+)/.exec(s)?.[1]);
    expect(later).toContain(`UID:${eventUid('test-beach', win.startMs)}`);
    expect(seq(later)).toBeGreaterThan(seq(unfolded));
  });
  it('an empty list is still a valid calendar', () => {
    expect(buildIcs([], { now })).toBe('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//refcell//gust//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:gust wind windows\r\nEND:VCALENDAR\r\n');
  });
});

describe('calendarWindows', () => {
  const hourly = [W('2026-06-01T10:00', 10), W('2026-06-01T11:00', 18, 260), W('2026-06-01T12:00', 20, 280), W('2026-06-01T13:00', 22, 270), W('2026-06-01T14:00', 10), W('2026-06-03T12:00', 20), W('2026-06-03T13:00', 20), W('2026-06-03T14:00', 20)];
  const wind = windOf(hourly, -25200, undefined, '2026-06-01T10:00');
  const now = wind.observedAt;
  it('converts local windows to UTC with an exclusive end and summarises the wind', () => {
    const [w, ...rest] = calendarWindows([{ spot, wind }], DEFAULT_SETTINGS, now);
    expect(rest).toHaveLength(0); // the 2026-06-03 window is beyond 48 h
    expect(icsDate(w.startMs)).toBe('20260601T180000Z');
    expect(icsDate(w.endMs)).toBe('20260601T210000Z');
    expect(w.avgKn).toBe(20);
    expect(w.maxKn).toBe(22);
    expect(w.maxGustKn).toBe(26);
    expect(w.dirDeg).toBe(270);
  });
  it('honours minWindowHours, mutes, missing data and staleness', () => {
    expect(calendarWindows([{ spot, wind }], { ...DEFAULT_SETTINGS, minWindowHours: 4 }, now)).toHaveLength(0);
    expect(calendarWindows([{ spot, wind }], { ...DEFAULT_SETTINGS, muted: [spot.id] }, now)).toHaveLength(0);
    expect(calendarWindows([{ spot, wind: undefined }], DEFAULT_SETTINGS, now)).toHaveLength(0);
    expect(calendarWindows([{ spot, wind }], DEFAULT_SETTINGS, now + 3 * 3600_000)).toHaveLength(0);
  });
  it('keeps a window that is under way (same UID as before it started)', () => {
    const fresh = { ...wind, observedAt: now + 2 * 3600_000 };
    const [w] = calendarWindows([{ spot, wind: fresh }], DEFAULT_SETTINGS, now + 2 * 3600_000);
    expect(icsDate(w.startMs)).toBe('20260601T180000Z');
  });
  it('uses the IANA zone across a DST change (Europe/Berlin, 29 Mar 2026)', () => {
    // Open-Meteo reports the offset at request time (+01:00); after 02:00 local the zone is +02:00.
    const h = ['2026-03-28T23:00', '2026-03-29T00:00', '2026-03-29T01:00', '2026-03-29T03:00', '2026-03-29T04:00', '2026-03-29T05:00'].map((t) => W(t, 20));
    const bw = windOf(h, 3600, 'Europe/Berlin', '2026-03-28T23:00');
    const wins = calendarWindows([{ spot, wind: bw }], DEFAULT_SETTINGS, bw.observedAt);
    expect(wins).toHaveLength(2); // the skipped 02:00 hour breaks the run
    expect(icsDate(wins[0].startMs)).toBe('20260328T220000Z');
    expect(icsDate(wins[0].endMs)).toBe('20260329T010000Z');
    expect(icsDate(wins[1].startMs)).toBe('20260329T010000Z');
    expect(icsDate(wins[1].endMs)).toBe('20260329T040000Z');
    // Without the zone, the fixed offset is used (one hour off after the change).
    const fixed = calendarWindows([{ spot, wind: { ...bw, timezone: undefined } }], DEFAULT_SETTINGS, bw.observedAt);
    expect(icsDate(fixed[1].startMs)).toBe('20260329T020000Z');
  });
  it('fall back in New York keeps hours in UTC order', () => {
    expect(icsDate(localIsoToEpochInZone('2026-11-01T00:30', 'America/New_York', -14400))).toBe('20261101T043000Z');
    expect(icsDate(localIsoToEpochInZone('2026-11-01T03:00', 'America/New_York', -14400))).toBe('20261101T080000Z');
  });
  it('parseLocation keeps the Open-Meteo timezone', () => {
    const loc = { utc_offset_seconds: 3600, timezone: 'Europe/Berlin', current: { time: '2026-03-28T23:00', wind_speed_10m: 20, wind_gusts_10m: 24, wind_direction_10m: 270 }, hourly: { time: [], wind_speed_10m: [], wind_gusts_10m: [], wind_direction_10m: [] } };
    expect(parseLocation(loc)?.timezone).toBe('Europe/Berlin');
  });
});
