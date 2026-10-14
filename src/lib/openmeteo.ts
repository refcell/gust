import type { LatLon } from './geo';
import type { SpotWind, WindSample } from './types';

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

export function parseLocation(loc: OMLocation, fetchedAt = Date.now()): SpotWind | null {
  const c = loc.current;
  const h = loc.hourly;
  if (!c || !h) return null;
  const hourly: WindSample[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const s = h.wind_speed_10m[i];
    const g = h.wind_gusts_10m[i];
    const d = h.wind_direction_10m[i];
    if (s == null || g == null || d == null) continue;
    hourly.push({ time: h.time[i], speedKn: s, gustKn: g, dirDeg: d });
  }
  return {
    current: { time: c.time, speedKn: c.wind_speed_10m, gustKn: c.wind_gusts_10m, dirDeg: c.wind_direction_10m },
    hourly,
    utcOffsetSeconds: loc.utc_offset_seconds,
    fetchedAt,
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
