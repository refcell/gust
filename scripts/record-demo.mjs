// Records the README demo: Playwright in a mobile viewport with deterministic wind, then ffmpeg -> mp4 + gif.
// Usage: pnpm build && node scripts/record-demo.mjs   (starts `vite preview` itself)
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { marineBody } from '../e2e/mocks.ts';

const FFMPEG = process.env.FFMPEG ?? (process.platform === 'darwin' ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
const PORT = 4179;
const base = `http://localhost:${PORT}/gust/`;
const tmp = 'test-results/demo-video';
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const server = spawn('pnpm', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 200));
}

// Mixed, realistic-looking conditions so the demo shows every rating.
const profile = [
  { s: 21, g: 26, d: 290 },
  { s: 18, g: 23, d: 280 },
  { s: 24, g: 31, d: 300 },
  { s: 13, g: 17, d: 270 },
  { s: 19, g: 25, d: 95 },
  { s: 9, g: 12, d: 260 },
  { s: 33, g: 41, d: 290 },
];
const OFFSET = -25200;
const localIso = (ms) => new Date(ms + OFFSET * 1000).toISOString().slice(0, 16);
function body(url) {
  const lats = new URL(url).searchParams.get('latitude').split(',');
  const nowLocal = localIso(Date.now());
  const current = nowLocal.slice(0, 14) + String(Math.floor(Number(nowLocal.slice(14, 16)) / 15) * 15).padStart(2, '0');
  const day0 = Date.parse(nowLocal.slice(0, 10) + 'T00:00:00Z') - OFFSET * 1000;
  const loc = (i) => {
    const p = profile[i % profile.length];
    const time = [], ws = [], wg = [], wd = [];
    for (let k = 0; k < 72; k++) {
      const t = localIso(day0 + k * 3600_000);
      const h = Number(t.slice(11, 13));
      time.push(t);
      const f = Math.max(0, Math.sin(((h - 8) / 12) * Math.PI)) * (0.7 + 0.3 * Math.sin(i + h / 5));
      ws.push(+(6 + f * (p.s + 2)).toFixed(1));
      wg.push(+(9 + f * (p.g + 2)).toFixed(1));
      wd.push(p.d === 95 ? 95 : 285 + Math.round(10 * Math.sin(h / 4)));
    }
    return { utc_offset_seconds: OFFSET, current: { time: current, wind_speed_10m: p.s, wind_gusts_10m: p.g, wind_direction_10m: p.d }, hourly: { time, wind_speed_10m: ws, wind_gusts_10m: wg, wind_direction_10m: wd } };
  };
  return lats.length > 1 ? lats.map((_, i) => loc(i)) : loc(0);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
  geolocation: { latitude: 37.8, longitude: -122.45 },
  permissions: ['geolocation', 'notifications'],
  serviceWorkers: 'block',
  recordVideo: { dir: tmp, size: { width: 390, height: 844 } },
});
await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(body(r.request().url())) }));
await ctx.route('https://marine-api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(marineBody()) }));
await ctx.route(/overpass/, (r) => r.fulfill({ contentType: 'application/json', body: '{"elements":[]}' }));
const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);

await page.goto(base);
await pause(1800);
await page.mouse.wheel(0, 500);
await pause(1200);
await page.goto(base + 'app/');
await page.getByText(/Updated/).waitFor();
await pause(2200);
await page.locator('.spot-head').first().tap();
await pause(2200);
await page.getByRole('button', { name: 'Favourite' }).first().tap();
await pause(1400);
await page.mouse.wheel(0, 300);
await pause(1200);
await page.mouse.wheel(0, -300);
await page.locator('.spot-head').first().tap();
await pause(800);
await page.getByRole('button', { name: 'Map', exact: true }).tap();
await page.locator('.map-marker, .map-cluster').first().waitFor();
await pause(2400);
await page.locator('.map-cluster, .map-marker').first().tap();
await pause(1800);
await page.locator('.map-marker').first().tap().catch(() => {});
await pause(2000);
await page.getByRole('button', { name: 'List', exact: true }).tap();
await pause(800);
await page.getByRole('tab', { name: 'Settings' }).tap();
await pause(1200);
await page.getByText('mph', { exact: true }).tap();
await pause(1000);
await page.getByRole('tab', { name: 'Alerts' }).tap();
await pause(1800);
await page.getByRole('tab', { name: 'Spots' }).tap();
await pause(2000);
await ctx.close();
await browser.close();
server.kill();

const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
renameSync(`${tmp}/${webm}`, `${tmp}/demo.webm`);
mkdirSync('assets', { recursive: true });
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', `${tmp}/demo.webm`, '-vf', 'fps=30,scale=390:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-crf', '26', 'assets/demo.mp4']);
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', `${tmp}/demo.webm`, '-vf', 'fps=12,scale=300:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer', 'assets/demo.gif']);
console.log('wrote assets/demo.mp4 and assets/demo.gif');
