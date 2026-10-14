import type { Page, Route } from '@playwright/test';

/** Deterministic Open-Meteo response: every location gets 22 kn from 270°, plus a light afternoon. */
export function openMeteoBody(url: string) {
  const u = new URL(url);
  const lats = (u.searchParams.get('latitude') ?? '').split(',');
  const time: string[] = [];
  const speed: number[] = [];
  const gust: number[] = [];
  const dir: number[] = [];
  for (let d = 0; d < 3; d++)
    for (let h = 0; h < 24; h++) {
      time.push(`2026-06-0${d + 1}T${String(h).padStart(2, '0')}:00`);
      const on = h >= 11 && h <= 18;
      speed.push(on ? 22 : 8);
      gust.push(on ? 27 : 11);
      dir.push(270);
    }
  const loc = (i: number) => ({
    latitude: Number(lats[i]),
    utc_offset_seconds: -25200,
    current: { time: '2026-06-01T12:00', wind_speed_10m: i % 3 === 2 ? 9 : 22, wind_gusts_10m: 27, wind_direction_10m: i % 3 === 1 ? 90 : 270 },
    hourly: { time, wind_speed_10m: speed, wind_gusts_10m: gust, wind_direction_10m: dir },
  });
  return lats.length > 1 ? lats.map((_, i) => loc(i)) : loc(0);
}

export async function mockNetwork(page: Page) {
  await page.route('https://api.open-meteo.com/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(openMeteoBody(route.request().url())) }),
  );
  await page.route('https://overpass-api.de/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"elements":[]}' }));
  await page.route('https://overpass.kumi.systems/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"elements":[]}' }));
}
