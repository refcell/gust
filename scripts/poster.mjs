// Renders the landing-page demo poster (light + dark) from the real app in demo mode with mocked
// wind, at the phone frame's inner size. Usage: pnpm build && node scripts/poster.mjs
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { openMeteoBody } from '../e2e/mocks.ts';

const port = 4190;
const server = spawn('./node_modules/.bin/vite', ['preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const base = `http://localhost:${port}/gust/`;
try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(base).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 300, height: 620 }, deviceScaleFactor: 2, colorScheme: scheme, serviceWorkers: 'block' });
    await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(openMeteoBody(r.request().url())) }));
    await ctx.route(/overpass|tile\.openstreetmap/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(base + 'app/?demo=1');
    await page.getByText(/Updated \d/).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `public/demo-poster-${scheme}.jpg`, type: 'jpeg', quality: 75 });
    await ctx.close();
  }
  await browser.close();
  console.log('wrote public/demo-poster-{light,dark}.jpg');
} finally {
  server.kill();
}
