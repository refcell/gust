import { expect, test } from '@playwright/test';
import { mockNetwork } from './mocks';

test.describe('app', () => {
  test.beforeEach(async ({ page, context }) => {
    await mockNetwork(page);
    await context.grantPermissions(['geolocation']);
    // Near Crissy Field, San Francisco.
    await context.setGeolocation({ latitude: 37.8, longitude: -122.45 });
  });

  test('shows nearby spots with wind and scores', async ({ page }) => {
    await page.goto('/gust/app/');
    await expect(page.getByRole('heading', { name: 'Near you' })).toBeVisible();
    await expect(page.getByText('Crissy Field')).toBeVisible();
    await expect(page.locator('.badge').first()).toBeVisible();
    await expect(page.getByText(/Updated \d/)).toBeVisible();
  });

  test('expands a spot to show hourly forecast', async ({ page }) => {
    await page.goto('/gust/app/');
    const head = page.getByRole('button', { name: /Crissy Field/ });
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('img', { name: 'Wind for the next 48 hours' })).toBeVisible();
    await expect(page.getByText('Rideable from')).toBeVisible();
  });

  test('changes units in settings', async ({ page }) => {
    await page.goto('/gust/app/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByText('m/s', { exact: true }).click();
    await page.getByRole('button', { name: 'Spots' }).click();
    await page.getByRole('button', { name: /Crissy Field/ }).click();
    await expect(page.getByText(/11\.3 m\/s/).first()).toBeVisible();
  });

  test('demo mode works without geolocation', async ({ page }) => {
    await page.goto('/gust/app/?demo=1');
    await expect(page.getByText('Demo mode')).toBeVisible();
    await expect(page.getByText('Crissy Field')).toBeVisible();
  });

  test('alerts panel explains platform support', async ({ page }) => {
    await page.goto('/gust/app/');
    await page.getByRole('button', { name: 'Alerts' }).click();
    await expect(page.getByRole('heading', { name: 'On this device' })).toBeVisible();
  });
});
