import { localIsoToEpoch } from './time';
import type { SpeedUnit } from './units';

/** Open-Meteo Marine API (no key, CORS ok). Wave, sea temperature and sea level (tide) forecasts. */
export const OPEN_METEO_MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const VARS = 'wave_height,wave_period,wave_direction,sea_surface_temperature,sea_level_height_msl';

export function marineUrl(lat: number, lon: number, days = 2): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: VARS,
    timezone: 'auto',
    forecast_days: String(days),
  });
  return `${OPEN_METEO_MARINE}?${q}`;
}

export interface MarineHour {
  time: string;
  /** Epoch ms of `time`. */
  at: number;
  waveM: number | null;
  periodS: number | null;
  waveDirDeg: number | null;
  seaTempC: number | null;
  /** Sea level relative to mean sea level (m), including tides. */
  seaLevelM: number | null;
}

export interface MarineData {
  utcOffsetSeconds: number;
  hourly: MarineHour[];
}

interface OMMarine {
  utc_offset_seconds?: number;
  hourly?: {
    time?: string[];
    wave_height?: (number | null)[];
    wave_period?: (number | null)[];
    wave_direction?: (number | null)[];
    sea_surface_temperature?: (number | null)[];
    sea_level_height_msl?: (number | null)[];
  };
}

const ISO_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/**
 * Parse a Marine API response. Returns null when there is no usable marine data at all (inland
 * lakes/rivers get all-null series or an error), so callers render nothing.
 */
export function parseMarine(json: unknown): MarineData | null {
  const j = json as OMMarine | null;
  const h = j?.hourly;
  const offset = j?.utc_offset_seconds;
  if (!h || !Array.isArray(h.time) || typeof offset !== 'number' || !Number.isFinite(offset)) return null;
  const hourly: MarineHour[] = [];
  let any = false;
  for (let i = 0; i < h.time.length; i++) {
    const time = h.time[i];
    if (typeof time !== 'string' || !ISO_MINUTE.test(time)) continue;
    const hour: MarineHour = {
      time,
      at: localIsoToEpoch(time, offset),
      waveM: num(h.wave_height?.[i], 0, 40),
      periodS: num(h.wave_period?.[i], 0, 40),
      waveDirDeg: num(h.wave_direction?.[i], 0, 360),
      seaTempC: num(h.sea_surface_temperature?.[i], -3, 40),
      seaLevelM: num(h.sea_level_height_msl?.[i], -20, 20),
    };
    if (hour.waveM != null || hour.seaTempC != null || hour.seaLevelM != null) any = true;
    hourly.push(hour);
  }
  return any ? { utcOffsetSeconds: offset, hourly } : null;
}

/** Index of the hour containing `now`, or -1 (before the series, or after its last hour ends: an
 * expired forecast, e.g. an old cached response offline, must not look current). */
export function currentIndex(hourly: readonly MarineHour[], now: number): number {
  let idx = -1;
  for (let i = 0; i < hourly.length; i++) {
    if (hourly[i].at <= now) idx = i;
    else break;
  }
  if (idx >= 0 && now >= hourly[idx].at + 3600_000) return -1;
  return idx;
}

export interface TideExtreme {
  kind: 'high' | 'low';
  time: string;
  at: number;
  levelM: number;
}

export interface TideInfo {
  trend: 'rising' | 'falling';
  next: TideExtreme | null;
}

/**
 * Local extrema of a sea-level series (null breaks the series). Plateaus count once, at their
 * first hour.
 */
export function tideExtremes(hourly: readonly MarineHour[]): TideExtreme[] {
  const out: TideExtreme[] = [];
  for (let i = 1; i < hourly.length - 1; i++) {
    const a = hourly[i - 1].seaLevelM;
    const b = hourly[i].seaLevelM;
    if (a == null || b == null || a === b) continue;
    // Next value that differs from b (skip a plateau).
    let j = i + 1;
    while (j < hourly.length && hourly[j].seaLevelM === b) j++;
    const c = j < hourly.length ? hourly[j].seaLevelM : null;
    if (c == null) continue;
    if (b > a && b > c) out.push({ kind: 'high', time: hourly[i].time, at: hourly[i].at, levelM: b });
    else if (b < a && b < c) out.push({ kind: 'low', time: hourly[i].time, at: hourly[i].at, levelM: b });
  }
  return out;
}

/** Rising/falling now and the next high or low within `horizonMs`; null without tide data. */
export function tideInfo(data: MarineData, now: number, horizonMs = 24 * 3600_000): TideInfo | null {
  const h = data.hourly;
  const i = currentIndex(h, now);
  if (i < 0 || h[i].seaLevelM == null) return null;
  const cur = h[i].seaLevelM;
  let j = i + 1;
  while (j < h.length && h[j].seaLevelM === cur) j++;
  const nextLevel = j < h.length ? h[j].seaLevelM : null;
  if (nextLevel == null) return null;
  const trend = nextLevel > cur ? 'rising' : 'falling';
  const next = tideExtremes(h).find((e) => e.at > h[i].at && e.at <= now + horizonMs) ?? null;
  return { trend, next };
}

export interface MarineNow {
  waveM: number | null;
  periodS: number | null;
  waveDirDeg: number | null;
  seaTempC: number | null;
  tide: TideInfo | null;
}

/** Current conditions; null when nothing is known for the current hour (show nothing). */
export function marineNow(data: MarineData | null, now = Date.now()): MarineNow | null {
  if (!data) return null;
  const i = currentIndex(data.hourly, now);
  if (i < 0) return null;
  const h = data.hourly[i];
  const tide = tideInfo(data, now);
  if (h.waveM == null && h.seaTempC == null && !tide) return null;
  return { waveM: h.waveM, periodS: h.periodS, waveDirDeg: h.waveDirDeg, seaTempC: h.seaTempC, tide };
}

/** Imperial (ft, °F) when the speed unit is mph, metric otherwise. */
export function imperial(unit: SpeedUnit): boolean {
  return unit === 'mph';
}

export function formatWaveHeight(m: number, unit: SpeedUnit): string {
  if (imperial(unit)) return `${(m * 3.28084).toFixed(1)} ft`;
  return `${m.toFixed(1)} m`;
}

export function formatWaterTemp(c: number, unit: SpeedUnit): string {
  if (imperial(unit)) return `${Math.round((c * 9) / 5 + 32)} °F`;
  return `${Math.round(c)} °C`;
}

/** Rough wetsuit guide by water temperature (°C). */
export function wetsuitHint(c: number): string {
  if (c < 10) return 'drysuit or 5/6 mm';
  if (c < 15) return '5/4 mm';
  if (c < 19) return '4/3 mm';
  if (c <= 22) return '3/2 mm or shorty';
  return 'boardshorts or lycra';
}

/** "HH:MM" of an Open-Meteo local ISO time (already in the spot's time zone). */
export function localClock(iso: string): string {
  return iso.slice(11, 16);
}
