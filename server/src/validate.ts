import { b64urlDecode } from './b64';
import type { PushSubscriptionJSON } from './webpush';
import type { Sector } from '../../src/lib/sectors';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/types';
import type { SpeedUnit } from '../../src/lib/units';
import { MAX_PUSH_SPOTS } from '../../src/lib/limits';

export const MAX_SPOTS = MAX_PUSH_SPOTS;
export const MAX_BODY_BYTES = 64 * 1024;

export interface SubSpot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  sectors: Sector[];
}

export interface Subscriber {
  subscription: PushSubscriptionJSON;
  settings: Settings;
  location: { lat: number; lon: number } | null;
  spots: SubSpot[];
  tz: string;
  updatedAt: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const UNITS: readonly SpeedUnit[] = ['kn', 'mph', 'ms', 'kmh'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

class Invalid extends Error {}
function need(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Invalid(msg);
}

function b64len(s: string): number {
  try {
    return b64urlDecode(s).length;
  } catch {
    return -1;
  }
}

export function validateSubscription(v: unknown): PushSubscriptionJSON {
  need(isObj(v), 'subscription must be an object');
  need(str(v.endpoint, 2048), 'subscription.endpoint required');
  let url: URL;
  try {
    url = new URL(v.endpoint);
  } catch {
    throw new Invalid('subscription.endpoint must be a URL');
  }
  need(url.protocol === 'https:', 'subscription.endpoint must be https');
  need(isObj(v.keys), 'subscription.keys required');
  const { p256dh, auth } = v.keys;
  need(str(p256dh, 128) && b64len(p256dh) === 65 && b64urlDecode(p256dh)[0] === 4, 'subscription.keys.p256dh invalid');
  need(str(auth, 64) && b64len(auth) === 16, 'subscription.keys.auth invalid');
  return { endpoint: v.endpoint, keys: { p256dh, auth } };
}

function validateSettings(v: unknown): Settings {
  if (v === undefined || v === null) return { ...DEFAULT_SETTINGS };
  need(isObj(v), 'settings must be an object');
  const s = { ...DEFAULT_SETTINGS, ...v } as Record<string, unknown>;
  need(num(s.minKn, 0, 100), 'settings.minKn out of range');
  need(num(s.maxKn, 0, 150) && s.maxKn >= s.minKn, 'settings.maxKn out of range');
  need(num(s.maxGustKn, 0, 200), 'settings.maxGustKn out of range');
  need(typeof s.unit === 'string' && UNITS.includes(s.unit as SpeedUnit), 'settings.unit invalid');
  need(num(s.radiusKm, 0, 20000), 'settings.radiusKm out of range');
  need(typeof s.forecastAlerts === 'boolean', 'settings.forecastAlerts must be boolean');
  need(num(s.minWindowHours, 1, 48) && Number.isInteger(s.minWindowHours), 'settings.minWindowHours out of range');
  return {
    minKn: s.minKn,
    maxKn: s.maxKn,
    maxGustKn: s.maxGustKn,
    unit: s.unit as SpeedUnit,
    radiusKm: s.radiusKm,
    forecastAlerts: s.forecastAlerts,
    minWindowHours: s.minWindowHours,
  };
}

function validateLatLon(v: unknown, what: string): { lat: number; lon: number } {
  need(isObj(v) && num(v.lat, -90, 90) && num(v.lon, -180, 180), `${what} lat/lon invalid`);
  return { lat: v.lat, lon: v.lon };
}

function validateSpots(v: unknown): SubSpot[] {
  if (v === undefined) return [];
  need(Array.isArray(v), 'spots must be an array');
  need(v.length <= MAX_SPOTS, `at most ${MAX_SPOTS} spots`);
  const seen = new Set<string>();
  const out: SubSpot[] = [];
  v.forEach((s: unknown, i) => {
    need(isObj(s), `spots[${i}] must be an object`);
    need(str(s.id, 128), `spots[${i}].id required`);
    need(str(s.name, 200), `spots[${i}].name required`);
    const { lat, lon } = validateLatLon(s, `spots[${i}]`);
    const sectors = s.sectors ?? [];
    need(Array.isArray(sectors) && sectors.length <= 12, `spots[${i}].sectors invalid`);
    for (const sec of sectors) need(Array.isArray(sec) && sec.length === 2 && num(sec[0], -360, 720) && num(sec[1], -360, 720), `spots[${i}].sectors invalid`);
    if (seen.has(s.id)) return;
    seen.add(s.id);
    out.push({ id: s.id, name: s.name, lat, lon, sectors: (sectors as number[][]).map((x) => [x[0], x[1]] as Sector) });
  });
  return out;
}

function validateTz(v: unknown): string {
  if (v === undefined || v === null || v === '') return 'UTC';
  need(str(v, 64), 'tz invalid');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
  } catch {
    throw new Invalid('tz invalid');
  }
  return v;
}

export function parseSubscribe(body: unknown, now = Date.now()): Result<Subscriber> {
  try {
    need(isObj(body), 'body must be a JSON object');
    return {
      ok: true,
      value: {
        subscription: validateSubscription(body.subscription),
        settings: validateSettings(body.settings),
        location: body.location == null ? null : validateLatLon(body.location, 'location'),
        spots: validateSpots(body.spots),
        tz: validateTz(body.tz),
        updatedAt: now,
      },
    };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

export function parseUnsubscribe(body: unknown): Result<{ endpoint: string }> {
  if (!isObj(body) || !str(body.endpoint, 2048)) return { ok: false, error: 'endpoint required' };
  return { ok: true, value: { endpoint: body.endpoint } };
}
