import { DEFAULT_SETTINGS, type Place, type Settings } from './types';
import type { LatLon } from './geo';

const LS = {
  settings: 'gust.settings',
  places: 'gust.places',
  lastLoc: 'gust.lastLocation',
};

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

export function loadSettings(): Settings {
  const s = read<Settings>(LS.settings, DEFAULT_SETTINGS);
  return sanitize(s);
}

export function sanitize(s: Settings): Settings {
  const minKn = clamp(s.minKn, 3, 60);
  const maxKn = clamp(Math.max(s.maxKn, minKn + 1), 4, 80);
  return {
    ...s,
    minKn,
    maxKn,
    maxGustKn: clamp(Math.max(s.maxGustKn, maxKn), 5, 90),
    radiusKm: clamp(s.radiusKm, 5, 500),
    minWindowHours: clamp(Math.round(s.minWindowHours), 1, 12),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(LS.settings, JSON.stringify(s));
}

export function loadPlaces(): Place[] {
  try {
    return JSON.parse(localStorage.getItem(LS.places) ?? '[]');
  } catch {
    return [];
  }
}

export function savePlaces(p: Place[]): void {
  localStorage.setItem(LS.places, JSON.stringify(p));
}

export function loadLastLocation(): (LatLon & { at: number; label?: string }) | null {
  try {
    return JSON.parse(localStorage.getItem(LS.lastLoc) ?? 'null');
  } catch {
    return null;
  }
}

export function saveLastLocation(l: LatLon & { at: number; label?: string }): void {
  localStorage.setItem(LS.lastLoc, JSON.stringify(l));
}
