import { goodWindows } from './forecast';
import { compass, normDeg } from './sectors';
import { isStale, localIsoToEpochInZone } from './time';
import type { Settings, Spot, SpotWind } from './types';
import { formatSpeed, type SpeedUnit } from './units';

const HOUR = 3600_000;
export const APP_URL = 'https://refcell.github.io/gust/app/';

/** One forecast good window at a spot, in UTC epoch ms. `endMs` is exclusive (end of the last good hour). */
export interface CalendarWindow {
  spotId: string;
  spotName: string;
  lat: number;
  lon: number;
  startMs: number;
  endMs: number;
  avgKn: number;
  maxKn: number;
  maxGustKn: number;
  /** Circular mean wind-from direction over the window, degrees. */
  dirDeg: number;
}

/**
 * Good windows (same rules as forecast alerts: settings + minWindowHours) that overlap
 * [now, now + horizonHours) at watched, non-muted spots with fresh data. Sorted by start.
 */
export function calendarWindows(entries: readonly { spot: Spot; wind: SpotWind | undefined }[], settings: Settings, now: number, horizonHours = 48): CalendarWindow[] {
  const muted = new Set(settings.muted ?? []);
  const horizon = now + horizonHours * HOUR;
  const out: CalendarWindow[] = [];
  for (const { spot, wind } of entries) {
    if (!wind || muted.has(spot.id) || isStale(wind, now)) continue;
    const toMs = (iso: string) => localIsoToEpochInZone(iso, wind.timezone, wind.utcOffsetSeconds);
    for (const w of goodWindows(wind.hourly, spot.sectors, settings)) {
      const startMs = toMs(w.start);
      const endMs = toMs(w.end) + HOUR;
      if (!(endMs > now && startMs < horizon)) continue;
      const hours = wind.hourly.filter((h) => h.time >= w.start && h.time <= w.end);
      let x = 0;
      let y = 0;
      for (const h of hours) {
        x += Math.cos((h.dirDeg * Math.PI) / 180);
        y += Math.sin((h.dirDeg * Math.PI) / 180);
      }
      out.push({
        spotId: spot.id,
        spotName: spot.name,
        lat: spot.lat,
        lon: spot.lon,
        startMs,
        endMs,
        avgKn: w.avgKn,
        maxKn: Math.max(...hours.map((h) => h.speedKn)),
        maxGustKn: w.maxGustKn,
        dirDeg: Math.round(normDeg((Math.atan2(y, x) * 180) / Math.PI)) % 360,
      });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.spotName.localeCompare(b.spotName));
}

/** RFC 5545 UTC date-time: 20260601T140000Z. */
export function icsDate(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/[-:]/g, '').replace('.000', '');
}

/** Escape a TEXT value (RFC 5545 3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

const enc = new TextEncoder();

/** Fold a content line to at most 75 octets per physical line, never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let octets = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (octets + n > limit) {
      parts.push(cur);
      cur = '';
      octets = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    octets += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** Stable per spot + window start, so re-importing updates the event where calendars support it. */
export function eventUid(spotId: string, startMs: number): string {
  return `${spotId}-${icsDate(startMs)}@gust.refcell.github.io`;
}

export function spotUrl(spotId: string): string {
  return `${APP_URL}?spot=${encodeURIComponent(spotId)}`;
}

/** Build an iCalendar (RFC 5545) file with one VEVENT (+ 60 min display alarm) per window. */
export function buildIcs(wins: readonly CalendarWindow[], opts: { now: number; unit?: SpeedUnit }): string {
  const unit = opts.unit ?? 'kn';
  const stamp = icsDate(opts.now);
  // Re-exports carry a higher SEQUENCE so calendars that honour it replace the earlier copy.
  const seq = Math.max(0, Math.floor(opts.now / 60_000));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//refcell//gust//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:gust wind windows'];
  for (const w of wins) {
    const url = spotUrl(w.spotId);
    const lat = w.lat.toFixed(5);
    const lon = w.lon.toFixed(5);
    const desc = [
      `Average ${formatSpeed(w.avgKn, unit)}, max ${formatSpeed(w.maxKn, unit)}, gusts to ${formatSpeed(w.maxGustKn, unit)}, from ${compass(w.dirDeg)} (${w.dirDeg}°).`,
      'Forecast snapshot from gust; re-export to refresh.',
      url,
    ].join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${eventUid(w.spotId, w.startMs)}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${seq}`,
      `DTSTART:${icsDate(w.startMs)}`,
      `DTEND:${icsDate(w.endMs)}`,
      `SUMMARY:${escapeText(`Wind on: ${w.spotName} (${formatSpeed(w.avgKn, unit)})`)}`,
      `DESCRIPTION:${escapeText(desc)}`,
      `LOCATION:${escapeText(`${lat},${lon}`)}`,
      `GEO:${lat};${lon}`,
      `URL:${url}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(`Wind on soon: ${w.spotName}`)}`,
      'TRIGGER:-PT60M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
