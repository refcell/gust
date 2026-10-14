import spotsUrl from '../../data/spots.json?url';
import type { Spot } from '../lib/types';

let cache: Promise<Spot[]> | null = null;

/** Curated spots, fetched as a separate static asset so the app bundle stays small. */
export function loadCuratedSpots(): Promise<Spot[]> {
  cache ??= fetch(spotsUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`spots ${r.status}`);
      return r.json() as Promise<Spot[]>;
    })
    .then((arr) => arr.map((s) => ({ ...s, source: 'curated' as const, sectorSource: s.sectors?.length ? ('curated' as const) : ('unknown' as const) })))
    .catch((e) => {
      cache = null;
      throw e;
    });
  return cache;
}

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
  detail: string;
}

/** Place search via Open-Meteo geocoding (no key). */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  const q = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' });
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`);
  if (!r.ok) throw new Error(`geocode ${r.status}`);
  const j = (await r.json()) as { results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[] };
  return (j.results ?? []).map((x) => ({
    name: x.name,
    lat: x.latitude,
    lon: x.longitude,
    detail: [x.admin1, x.country].filter(Boolean).join(', '),
  }));
}
