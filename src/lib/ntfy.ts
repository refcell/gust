import type { LatLon } from './geo';
import { MAX_PUSH_SPOTS } from './limits';
import { pushSpots } from './pushsync';
import { sanitize } from './settings';
import { nearbySpots } from './spots';
import { DEFAULT_SETTINGS, type Place, type Settings, type Spot } from './types';
import type { SpeedUnit } from './units';
import { watchSets, type SpotGroup } from './watch';

/**
 * No-account background alerts: the app builds a config (repository variable
 * `GUST_ALERTS_CONFIG`), and `scripts/ntfy-alerts.ts` (scheduled GitHub Actions workflow) resolves
 * the watched spots from it, scores them with the shared alert logic and publishes to ntfy.
 */

/** Settings the config carries (a subset of `Settings`; favourites are top level). */
export type AlertsConfigSettings = Pick<Settings, 'unit' | 'minKn' | 'maxKn' | 'maxGustKn' | 'radiusKm' | 'forecastAlerts' | 'minWindowHours' | 'muted'>;

export interface AlertsConfig {
  places: { name: string; lat: number; lon: number }[];
  favorites: string[];
  settings: AlertsConfigSettings;
  /** IANA time zone for quiet hours. */
  timezone: string;
  /** Local "start-end" hours without notifications (wraps midnight); "" disables. Default 22-6. */
  quietHours: string;
  /** Opened when a notification is tapped (`?spot=<id>` appended). */
  appUrl: string;
}

export const DEFAULT_APP_URL = 'https://refcell.github.io/gust/app/';
export const DEFAULT_QUIET_HOURS = '22-6';
export const MAX_CONFIG_PLACES = 20;
const UNITS: readonly SpeedUnit[] = ['kn', 'mph', 'ms', 'kmh'];
const QUIET_RE = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/;
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function settingsSubset(s: Settings): AlertsConfigSettings {
  return {
    unit: s.unit,
    minKn: s.minKn,
    maxKn: s.maxKn,
    maxGustKn: s.maxGustKn,
    radiusKm: s.radiusKm,
    forecastAlerts: s.forecastAlerts,
    minWindowHours: s.minWindowHours,
    muted: [...(s.muted ?? [])],
  };
}

/**
 * The `GUST_ALERTS_CONFIG` value for the current app state: saved places (or, without any, the
 * last location rounded to ~100 m), favourites and the alert settings.
 */
export function buildAlertsConfig(o: { places: readonly Place[]; settings: Settings; loc?: LatLon | null; timezone: string }): AlertsConfig {
  const places = o.places.length
    ? o.places.map((p) => ({ name: p.name, lat: round(p.lat, 4), lon: round(p.lon, 4) }))
    : o.loc
      ? [{ name: 'Last location', lat: round(o.loc.lat, 3), lon: round(o.loc.lon, 3) }]
      : [];
  return {
    places: places.slice(0, MAX_CONFIG_PLACES),
    favorites: [...(o.settings.favorites ?? [])],
    settings: settingsSubset(o.settings),
    timezone: o.timezone,
    quietHours: DEFAULT_QUIET_HOURS,
    appUrl: DEFAULT_APP_URL,
  };
}

export type ParseResult = { ok: true; config: AlertsConfig } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse and validate `GUST_ALERTS_CONFIG`. Missing settings take the app defaults and are clamped
 * like the app's own settings (`sanitize`); malformed values are errors, never guessed.
 */
export function parseAlertsConfig(raw: string | undefined): ParseResult {
  if (!raw || !raw.trim()) return { ok: false, error: 'config is empty' };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'config is not valid JSON' };
  }
  if (!isObj(v)) return { ok: false, error: 'config must be a JSON object' };

  const places: AlertsConfig['places'] = [];
  if (v.places !== undefined) {
    if (!Array.isArray(v.places)) return { ok: false, error: 'places must be an array' };
    if (v.places.length > MAX_CONFIG_PLACES) return { ok: false, error: `at most ${MAX_CONFIG_PLACES} places` };
    for (const [i, p] of v.places.entries()) {
      if (!isObj(p) || !finite(p.lat) || !finite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return { ok: false, error: `places[${i}] needs numeric lat (-90..90) and lon (-180..180)` };
      places.push({ name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Place ${i + 1}`, lat: p.lat, lon: p.lon });
    }
  }
  if (v.favorites !== undefined && !strings(v.favorites)) return { ok: false, error: 'favorites must be an array of spot ids' };
  const favorites = (v.favorites as string[] | undefined) ?? [];
  if (places.length === 0 && favorites.length === 0) return { ok: false, error: 'config needs at least one place or favourite' };

  const s = v.settings === undefined ? {} : v.settings;
  if (!isObj(s)) return { ok: false, error: 'settings must be an object' };
  for (const k of ['minKn', 'maxKn', 'maxGustKn', 'radiusKm', 'minWindowHours'] as const) {
    if (s[k] !== undefined && !finite(s[k])) return { ok: false, error: `settings.${k} must be a number` };
  }
  if (s.unit !== undefined && !UNITS.includes(s.unit as SpeedUnit)) return { ok: false, error: `settings.unit must be one of ${UNITS.join(', ')}` };
  if (s.forecastAlerts !== undefined && typeof s.forecastAlerts !== 'boolean') return { ok: false, error: 'settings.forecastAlerts must be true or false' };
  if (s.muted !== undefined && !strings(s.muted)) return { ok: false, error: 'settings.muted must be an array of spot ids' };
  const merged = sanitize({ ...DEFAULT_SETTINGS, ...(s as Partial<Settings>) });

  const timezone = v.timezone === undefined ? 'UTC' : v.timezone;
  if (typeof timezone !== 'string' || !validTimeZone(timezone)) return { ok: false, error: 'timezone must be an IANA time zone, e.g. America/Los_Angeles' };
  const quietHours = v.quietHours === undefined ? DEFAULT_QUIET_HOURS : v.quietHours;
  if (typeof quietHours !== 'string' || (quietHours.trim() !== '' && !QUIET_RE.test(quietHours))) return { ok: false, error: 'quietHours must look like "22-6" (or "" to disable)' };
  const appUrl = v.appUrl === undefined ? DEFAULT_APP_URL : v.appUrl;
  if (typeof appUrl !== 'string' || !/^https?:\/\//.test(appUrl)) return { ok: false, error: 'appUrl must be an http(s) URL' };

  return { ok: true, config: { places, favorites, settings: settingsSubset(merged), timezone, quietHours: quietHours.trim(), appUrl } };
}

/** Full `Settings` for scoring (favourites included, as the app keeps them). */
export function configSettings(c: AlertsConfig): Settings {
  return { ...DEFAULT_SETTINGS, ...c.settings, favorites: [...c.favorites] };
}

/**
 * Watched spots for a config, resolved like the app: spots within the radius of each place (the
 * app's per-place list), every favourite, muted spots dropped, then capped at `max` with
 * favourites first and the rest nearest first (as the app sends to the push server).
 * `missingFavorites` lists favourite ids not in `allSpots` (e.g. OSM-only spots).
 */
export function resolveWatchedSpots(allSpots: readonly Spot[], c: AlertsConfig, max = MAX_PUSH_SPOTS): { spots: Spot[]; total: number; missingFavorites: string[] } {
  const settings = configSettings(c);
  const groups: SpotGroup[] = c.places.map((p) => ({ items: nearbySpots(allSpots, p, settings.radiusKm), fallback: false }));
  const favSet = new Set(c.favorites);
  const favSpots = allSpots.filter((s) => favSet.has(s.id));
  groups.push({ items: favSpots.map((spot) => ({ spot, distanceKm: NaN })), fallback: false });
  const { watched } = watchSets(groups, c.favorites);
  const have = new Set(favSpots.map((s) => s.id));
  const { spots, total } = pushSpots(watched, settings, c.places, max);
  return { spots, total, missingFavorites: c.favorites.filter((id) => !have.has(id)) };
}

const TOPIC_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const TOPIC_LENGTH = 24;

/** A random ntfy topic: 24 chars of [a-z0-9] (~124 bits), unguessable for practical purposes. */
export function randomTopic(rand: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  let out = '';
  while (out.length < TOPIC_LENGTH) {
    for (const x of rand(new Uint8Array(32))) {
      // Rejection sampling keeps the distribution uniform (252 = 7 * 36).
      if (x < 252 && out.length < TOPIC_LENGTH) out += TOPIC_CHARS[x % 36];
    }
  }
  return out;
}

/** ntfy topic names: 1-64 chars of letters, digits, `_` and `-`. */
export function validTopic(t: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(t);
}
