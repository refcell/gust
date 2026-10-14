import { expect, test } from '@playwright/test';
import { mockNetwork } from './mocks';

test('landing page has install button, demo, and links', async ({ page }) => {
  await mockNetwork(page);
  await page.goto('/gust/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('wind is on');
  await expect(page.getByRole('button', { name: 'Install gust' })).toBeVisible();
  // Demo: a still poster first; the live app boots on Start (or when the frame is mostly in view).
  await expect(page.locator('.phone .poster img')).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/refcell/gust');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/gust/manifest.webmanifest');
});

test('the live demo boots when scrolled into view', async ({ page }) => {
  await mockNetwork(page);
  await page.goto('/gust/');
  await page.locator('.demo .phone').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(page.frameLocator('iframe[title^="gust app"]').getByText(/Updated \d/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start live demo' })).toBeHidden();
});

test('Start live demo boots the app on demand', async ({ page }) => {
  // Short viewport: the frame can never be 60% visible, so only the button starts it.
  await page.setViewportSize({ width: 400, height: 300 });
  await mockNetwork(page);
  await page.goto('/gust/');
  await page.getByRole('button', { name: 'Start live demo' }).click();
  await expect(page.frameLocator('iframe[title^="gust app"]').getByText(/Updated \d/)).toBeVisible();
});

test('desktop shows a QR code', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await page.goto('/gust/');
  await expect(page.locator('#qr svg')).toBeVisible();
});

test('iOS Safari opens the Add to Home Screen sheet', async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto('/gust/');
  await page.getByRole('button', { name: 'Install gust' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Add to Home Screen', { exact: false }).first()).toBeVisible();
  await ctx.close();
});

test('in-app browsers are told to open Safari', async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0',
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto('/gust/');
  await expect(page.locator('#install-note')).toContainText('Safari');
  await ctx.close();
});

test('manifest is valid for install', async ({ request }) => {
  const res = await request.get('/gust/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toContain('/gust/app/');
  expect(m.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  for (const i of m.icons) expect((await request.get(i.src)).ok()).toBe(true);
  expect((await request.get('/gust/sw.js')).ok()).toBe(true);
});
