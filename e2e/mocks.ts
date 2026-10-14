import type { Page, Route } from '@playwright/test';

/** Deterministic Open-Meteo response: every location gets 22 kn from 270°, plus a light afternoon. */
const OFFSET = -25200; // UTC-7, like San Francisco in summer

/** Local ISO minute string at OFFSET for an epoch. */
function localIso(ms: number): string {
  return new Date(ms + OFFSET * 1000).toISOString().slice(0, 16);
}

/**
 * Deterministic Open-Meteo response relative to the real clock (so data is never "stale"):
 * locations cycle through 22 kn W (good), 22 kn E (offshore at west-facing spots), 9 kn W (light).
 */
export function openMeteoBody(url: string) {
  const u = new URL(url);
  const lats = (u.searchParams.get('latitude') ?? '').split(',');
  const now = Date.now();
  const nowLocal = localIso(now);
  const day0 = Date.parse(nowLocal.slice(0, 10) + 'T00:00:00Z') - OFFSET * 1000;
  const time: string[] = [];
  const speed: number[] = [];
  const gust: number[] = [];
  const dir: number[] = [];
  for (let i = 0; i < 72; i++) {
    const t = localIso(day0 + i * 3600_000);
    time.push(t);
    const h = Number(t.slice(11, 13));
    const on = h >= 11 && h <= 18;
    speed.push(on ? 22 : 8);
    gust.push(on ? 27 : 11);
    dir.push(270);
  }
  const current = nowLocal.slice(0, 14) + String(Math.floor(Number(nowLocal.slice(14, 16)) / 15) * 15).padStart(2, '0');
  const loc = (i: number) => ({
    latitude: Number(lats[i]),
    utc_offset_seconds: OFFSET,
    current: { time: current, wind_speed_10m: i % 3 === 2 ? 9 : 22, wind_gusts_10m: 27, wind_direction_10m: i % 3 === 1 ? 90 : 270 },
    hourly: { time, wind_speed_10m: speed, wind_gusts_10m: gust, wind_direction_10m: dir },
  });
  return lats.length > 1 ? lats.map((_, i) => loc(i)) : loc(0);
}

/**
 * Deterministic Open-Meteo Marine response relative to the real clock: 1.2 m at 9 s from 270°,
 * 16 °C water, and a tide with a 12 h period (high at 03/15, low at 09/21 local). `nulls` mimics an
 * inland point (every series null).
 */
export function marineBody(nulls = false) {
  const now = Date.now();
  const day0 = Date.parse(localIso(now).slice(0, 10) + 'T00:00:00Z') - OFFSET * 1000;
  const time: string[] = [];
  const level: (number | null)[] = [];
  for (let i = 0; i < 72; i++) {
    time.push(localIso(day0 + i * 3600_000));
    level.push(nulls ? null : Math.round(Math.cos(((i - 3) / 12) * 2 * Math.PI) * 100) / 100);
  }
  const fill = (v: number) => time.map(() => (nulls ? null : v));
  return {
    utc_offset_seconds: OFFSET,
    hourly: { time, wave_height: fill(1.2), wave_period: fill(9), wave_direction: fill(270), sea_surface_temperature: fill(16), sea_level_height_msl: level },
  };
}

/** 1x1 transparent PNG served for every OpenStreetMap tile. */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export async function mockNetwork(page: Page) {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG_1X1 }));
  await page.route('https://api.open-meteo.com/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(openMeteoBody(route.request().url())) }),
  );
  await page.route('https://marine-api.open-meteo.com/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(marineBody()) }),
  );
  await page.route('https://overpass-api.de/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"elements":[]}' }));
  await page.route('https://overpass.kumi.systems/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"elements":[]}' }));
}
