// Smoke-test a deployed gust: real network, service worker on, installability via CDP, offline reload.
// Usage: node scripts/verify-live.mjs [baseUrl]
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'https://refcell.github.io/gust/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], geolocation: { latitude: 37.8, longitude: -122.45 }, permissions: ['geolocation'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let ok = true;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) ok = false;
};

await page.goto(base);
const cdp = await ctx.newCDPSession(page);
const inst = await cdp.send('Page.getInstallabilityErrors');
check(inst.installabilityErrors.length === 0, `landing installable ${JSON.stringify(inst.installabilityErrors)}`);
const manifest = await cdp.send('Page.getAppManifest');
check(!manifest.errors?.length, `manifest parses ${JSON.stringify(manifest.errors ?? [])}`);

await page.goto(base + 'app/');
await page.getByText(/Updated \d/).waitFor({ timeout: 20000 });
const spots = await page.locator('.spot').count();
check(spots > 0, `app shows ${spots} spots near SF`);
const first = (await page.locator('.spot-head').first().innerText()).replace(/\s+/g, ' ');
check(/\d/.test(first), `first spot has live wind: ${first}`);
const sw = await page.evaluate(async () => !!(await navigator.serviceWorker.ready.then((r) => r.active)));
check(sw, 'service worker active');

await page.reload();
await page.getByText(/Updated \d/).waitFor({ timeout: 20000 });
await ctx.setOffline(true);
await page.reload();
await page.locator('.spot').first().waitFor({ timeout: 15000 }).catch(() => undefined);
check((await page.locator('.spot').count()) > 0, 'offline reload still shows spots');
await ctx.setOffline(false);
check(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
await browser.close();
process.exit(ok ? 0 : 1);
