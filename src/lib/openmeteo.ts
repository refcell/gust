import type { LatLon } from './geo';
import type { SpotWind, WindSample } from './types';
import { localIsoToEpoch } from './time';

export const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const VARS = 'wind_speed_10m,wind_gusts_10m,wind_direction_10m';
/** Locations per request; keeps URLs short. */
export const BATCH = 50;

export function forecastUrl(points: readonly LatLon[], days = 3): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(','),
    longitude: points.map((p) => p.lon.toFixed(4)).join(','),
    current: VARS,
    hourly: VARS,
    wind_speed_unit: 'kn',
    timezone: 'auto',
    forecast_days: String(days),
  });
  return `${OPEN_METEO}?${q}`;
}

interface OMLocation {
  utc_offset_seconds: number;
  current?: { time: string; wind_speed_10m: number; wind_gusts_10m: number; wind_direction_10m: number };
  hourly?: { time: string[]; wind_speed_10m: (number | null)[]; wind_gusts_10m: (number | null)[]; wind_direction_10m: (number | null)[] };
}

/** A physically valid sample: finite, non-negative speeds, direction in 0..360. */
export function validSample(s: unknown, g: unknown, d: unknown): boolean {
  return (
    typeof s === 'number' && Number.isFinite(s) && s >= 0 && s < 200 &&
    typeof g === 'number' && Number.isFinite(g) && g >= 0 && g < 250 &&
    typeof d === 'number' && Number.isFinite(d) && d >= 0 && d <= 360
  );
}

const ISO_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function parseLocation(loc: OMLocation, fetchedAt = Date.now()): SpotWind | null {
  const c = loc?.current;
  const h = loc?.hourly;
  const offset = loc?.utc_offset_seconds;
  if (!c || !h || !Array.isArray(h.time) || typeof offset !== 'number' || !Number.isFinite(offset)) return null;
  if (typeof c.time !== 'string' || !ISO_MINUTE.test(c.time)) return null;
  if (!validSample(c.wind_speed_10m, c.wind_gusts_10m, c.wind_direction_10m)) return null;
  const hourly: WindSample[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const s = h.wind_speed_10m?.[i];
    const g = h.wind_gusts_10m?.[i];
    const d = h.wind_direction_10m?.[i];
    if (typeof h.time[i] !== 'string' || !ISO_MINUTE.test(h.time[i]) || !validSample(s, g, d)) continue;
    hourly.push({ time: h.time[i], speedKn: s as number, gustKn: g as number, dirDeg: d as number });
  }
  return {
    current: { time: c.time, speedKn: c.wind_speed_10m, gustKn: c.wind_gusts_10m, dirDeg: c.wind_direction_10m },
    hourly,
    utcOffsetSeconds: offset,
    fetchedAt,
    observedAt: localIsoToEpoch(c.time, offset),
  };
}

/** Fetch wind for many points (batched). Result array aligns with `points`; entries are null on failure. */
export async function fetchWind(points: readonly LatLon[], fetchImpl: typeof fetch = fetch): Promise<(SpotWind | null)[]> {
  const out: (SpotWind | null)[] = [];
  for (let i = 0; i < points.length; i += BATCH) {
    const chunk = points.slice(i, i + BATCH);
    try {
      const res = await fetchImpl(forecastUrl(chunk));
      if (!res.ok) throw new Error(`open-meteo ${res.status}`);
      const json = (await res.json()) as OMLocation | OMLocation[];
      const arr = Array.isArray(json) ? json : [json];
      const now = Date.now();
      for (let j = 0; j < chunk.length; j++) out.push(arr[j] ? parseLocation(arr[j], now) : null);
    } catch {
      for (let j = 0; j < chunk.length; j++) out.push(null);
    }
  }
  return out;
}

/** Samples fetched less than this long ago are reused instead of refetched. */
export const FRESH_MS = 10 * 60_000;

/**
 * Which spots need a network fetch: those without a sample fetched within `maxAgeMs`. `fresh`
 * holds the reusable samples by spot id (e.g. after a scoring-only settings change).
 */
export function splitFresh<S extends { id: string }>(spots: readonly S[], wind: Readonly<Record<string, SpotWind | undefined>>, now = Date.now(), maxAgeMs = FRESH_MS): { fresh: Record<string, SpotWind>; missing: S[] } {
  const fresh: Record<string, SpotWind> = {};
  const missing: S[] = [];
  for (const s of spots) {
    const w = wind[s.id];
    const age = w ? now - w.fetchedAt : Infinity;
    if (w && age >= 0 && age < maxAgeMs) fresh[s.id] = w;
    else missing.push(s);
  }
  return { fresh, missing };
}
