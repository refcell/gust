import { expect, test } from '@playwright/test';
import { openMeteoBody } from './mocks';

test('service worker installs, precaches the shell, and the app works offline', async ({ page, context }) => {
  // context.route also intercepts requests made by the service worker (Chromium).
  await context.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(openMeteoBody(route.request().url())) }),
  );
  await context.route(/overpass/, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"elements":[]}' }));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 37.8, longitude: -122.45 });

  await page.goto('/gust/app/');
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 10_000 })
    .toBe('activated');
  await expect(page.getByText(/Updated \d/)).toBeVisible();
  // Every precached URL resolved (addAll would have rejected the install otherwise).
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const shell = keys.find((k) => k.startsWith('gust-') && k !== 'gust-data');
    return shell ? (await (await caches.open(shell)).keys()).length : 0;
  });
  expect(cached).toBeGreaterThan(5);

  await page.reload();
  await expect(page.getByText(/Updated \d/)).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Crissy Field').first()).toBeVisible();
  await expect(page.locator('.spot-wind strong').first()).toBeVisible();
  await page.goto('/gust/');
  await expect(page.getByRole('button', { name: 'Install gust' })).toBeVisible();
  await context.setOffline(false);
});

test('landing and app are installable with a valid manifest (Chrome installability checks)', async ({ page, context }) => {
  await context.route(/open-meteo|overpass/, (route) => route.abort());
  for (const path of ['/gust/', '/gust/app/']) {
    await page.goto(path);
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.ready).active), { timeout: 10_000 }).toBe(true);
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors, path).toEqual([]);
    const { errors, url } = await cdp.send('Page.getAppManifest');
    expect(errors, path).toEqual([]);
    expect(url).toMatch(/manifest\.webmanifest$/);
    await cdp.detach();
  }
  const m = await (await page.request.get('/gust/manifest.webmanifest')).json();
  expect(m).toMatchObject({ id: '/gust/app/', scope: '/gust/', display: 'standalone' });
  expect(m.icons.some((i: { sizes: string; purpose?: string }) => i.sizes === '512x512' && i.purpose?.includes('maskable'))).toBe(true);
});
