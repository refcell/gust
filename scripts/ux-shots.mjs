// Visual QA: screenshots of the landing page and every app view at phone and tablet widths, light
// and dark, with mocked network. Usage: vite build && node scripts/ux-shots.mjs  (starts vite preview).
// Output: test-results/ux-shots/<viewport>-<scheme>-<view>.png
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { mockNetwork } from '../e2e/mocks.ts';

const PORT = Number(process.env.PW_PORT ?? 4395);
const base = `http://localhost:${PORT}/gust/`;
const out = 'test-results/ux-shots';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const server = spawn('./node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 200));
}

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const geo = { latitude: 37.8, longitude: -122.45 };
const only = process.env.ONLY?.split(',');
const viewports = [
  { name: '390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: '360', viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: '768', viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, tablet: true },
];

const browser = await chromium.launch();

async function ctxFor(vp, colorScheme, extra = {}) {
  const { name, tablet, ...opts } = vp;
  void name;
  void tablet;
  const ctx = await browser.newContext({ ...opts, userAgent: ANDROID_UA, colorScheme, serviceWorkers: 'block', ...extra });
  const page = await ctx.newPage();
  await mockNetwork(page);
  await page.route('https://geocoding-api.open-meteo.com/**', (r) =>
    r.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        results: [
          { name: 'Hood River', latitude: 45.71, longitude: -121.52, admin1: 'Oregon', country: 'United States' },
          { name: 'Hoodsport', latitude: 47.41, longitude: -123.14, admin1: 'Washington', country: 'United States' },
          { name: 'Mount Hood Village', latitude: 45.35, longitude: -121.98, admin1: 'Oregon', country: 'United States' },
        ],
      }),
    }),
  );
  return { ctx, page };
}

const shot = (page, file, opts = {}) => page.screenshot({ path: `${out}/${file}.png`, ...opts });
const want = (v) => !only || only.includes(v);

for (const vp of viewports) {
  for (const scheme of ['light', 'dark']) {
    const p = `${vp.name}-${scheme}`;
    // Landing
    if (want('landing')) {
      const { ctx, page } = await ctxFor(vp, scheme);
      await page.goto(base);
      await page.waitForTimeout(400);
      await shot(page, `${p}-landing-top`);
      await page.locator('.demo .phone').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.frameLocator('iframe[title^="gust app"]').getByText(/Updated \d/).waitFor().catch(() => {});
      await page.waitForTimeout(600);
      await shot(page, `${p}-landing-demo`);
      await shot(page, `${p}-landing-full`, { fullPage: true });
      await ctx.close();
    }
    if (vp.tablet) {
      if (want('spots')) {
        const { ctx, page } = await ctxFor(vp, scheme, { geolocation: geo, permissions: ['geolocation'] });
        await page.goto(base + 'app/');
        await page.getByText(/Updated \d/).waitFor();
        await page.getByRole('button', { name: /Crissy Field/ }).click();
        await page.getByLabel('Marine conditions').waitFor();
        await shot(page, `${p}-spots-expanded`);
        await ctx.close();
      }
      continue;
    }
    // Welcome (no geolocation permission)
    if (want('welcome')) {
      const { ctx, page } = await ctxFor(vp, scheme);
      await page.goto(base + 'app/');
      await page.getByRole('button', { name: 'Share location' }).waitFor();
      await shot(page, `${p}-welcome`);
      await ctx.close();
    }
    const { ctx, page } = await ctxFor(vp, scheme, { geolocation: geo, permissions: ['geolocation'] });
    await page.goto(base + 'app/');
    await page.getByText(/Updated \d/).waitFor();
    if (want('spots')) {
      await page.waitForTimeout(300);
      await shot(page, `${p}-spots`);
      await page.getByRole('button', { name: /Crissy Field/ }).click();
      await page.getByLabel('Marine conditions').waitFor();
      await page.locator('li.spot', { hasText: 'Crissy Field' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(200);
      await shot(page, `${p}-spots-expanded`);
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(200);
      await shot(page, `${p}-spots-expanded-2`);
      await page.getByRole('button', { name: /Crissy Field/ }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    if (want('map')) {
      await page.getByRole('button', { name: 'Map', exact: true }).click();
      const map = page.getByRole('region', { name: 'Map of nearby spots' });
      await map.waitFor();
      await page.waitForTimeout(400);
      await shot(page, `${p}-map`);
      const crissy = map.getByRole('button', { name: /^Crissy Field[^,]*, / });
      const cluster = map.locator('button.map-cluster[data-spots~="crissy-field"]');
      for (let i = 0; i < 6 && (await crissy.count()) === 0; i++) {
        await cluster.click();
        await page.waitForTimeout(400);
      }
      await crissy.click();
      await page.waitForTimeout(300);
      await shot(page, `${p}-map-selected`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      await shot(page, `${p}-map-selected-bottom`);
      await page.getByRole('button', { name: 'List', exact: true }).click();
    }
    if (want('places')) {
      await page.getByRole('tab', { name: 'Places' }).click();
      await page.waitForTimeout(200);
      await shot(page, `${p}-places`);
      await page.locator('#place-q').fill('hood');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByRole('list', { name: 'Matching spots' }).waitFor();
      await page.waitForTimeout(300);
      await shot(page, `${p}-places-results`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      await shot(page, `${p}-places-results-bottom`);
    }
    if (want('alerts')) {
      await page.getByRole('tab', { name: 'Alerts' }).click();
      await page.waitForTimeout(200);
      await shot(page, `${p}-alerts`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      await shot(page, `${p}-alerts-bottom`);
    }
    if (want('settings')) {
      await page.getByRole('tab', { name: 'Settings' }).click();
      await page.waitForTimeout(200);
      await shot(page, `${p}-settings`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      await shot(page, `${p}-settings-bottom`);
    }
    await ctx.close();
    // Alerts as iPhone Safari (not installed): install instructions row.
    if (want('alerts') && vp.name === '390') {
      const { ctx: c2, page: p2 } = await ctxFor(vp, scheme, { geolocation: geo, permissions: ['geolocation'], userAgent: IOS_UA });
      await p2.goto(base + 'app/');
      await p2.getByText(/Updated \d/).waitFor();
      await p2.getByRole('tab', { name: 'Alerts' }).click();
      await p2.waitForTimeout(200);
      await shot(p2, `${p}-alerts-ios`);
      await c2.close();
    }
  }
}

await browser.close();
server.kill();
console.log(`screenshots in ${out}`);
