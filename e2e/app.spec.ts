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
    // No stray falsy values rendered as text (e.g. "0").
    await expect(page.locator('main')).not.toHaveText(/^0|\n0\n/);
    await expect(page.getByText('cached wind')).toHaveCount(0);
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
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByText('m/s', { exact: true }).click();
    await page.getByRole('tab', { name: 'Spots' }).click();
    await page.getByRole('button', { name: /Crissy Field/ }).click();
    await expect(page.getByText(/11\.3 m\/s/).first()).toBeVisible();
  });

  test('far from any spot shows the nearest spots with wind', async ({ page, context }) => {
    await context.setGeolocation({ latitude: 38.5, longitude: -98.5 }); // central Kansas
    await page.goto('/gust/app/');
    await expect(page.getByRole('heading', { name: /Nearest spots/ })).toBeVisible();
    await expect(page.locator('.spot-wind strong').first()).toBeVisible();
  });

  test('demo mode works without geolocation', async ({ page }) => {
    await page.goto('/gust/app/?demo=1');
    await expect(page.getByText('Demo mode')).toBeVisible();
    await expect(page.getByText('Crissy Field')).toBeVisible();
  });

  test('alerts panel explains platform support', async ({ page }) => {
    await page.goto('/gust/app/');
    await page.getByRole('tab', { name: 'Alerts' }).click();
    await expect(page.getByRole('heading', { name: 'On this device' })).toBeVisible();
  });
});

test.describe('first run', () => {
  test.beforeEach(async ({ page }) => {
    await mockNetwork(page);
  });

  test('welcome card offers location, alerts and places', async ({ page, context }) => {
    await page.goto('/gust/app/');
    const welcome = page.getByRole('region', { name: 'Welcome to gust' });
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole('listitem')).toHaveCount(2);
    await welcome.getByRole('button', { name: 'or add a place' }).click();
    await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible();
    await expect(page.locator('#place-q')).toBeFocused();

    await page.getByRole('tab', { name: 'Spots' }).click();
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 37.8, longitude: -122.45 });
    await page.getByRole('button', { name: 'Share location' }).click();
    await expect(page.getByRole('heading', { name: 'Near you' })).toBeVisible();
    await expect(welcome).toHaveCount(0);
  });

  test('tab bar is keyboard operable', async ({ page }) => {
    await page.goto('/gust/app/');
    const spots = page.getByRole('tab', { name: 'Spots' });
    await expect(spots).toHaveAttribute('aria-selected', 'true');
    await spots.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Places' })).toBeFocused();
    await expect(page.getByRole('tabpanel', { name: 'Places' })).toBeVisible();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(spots).toBeFocused();
  });
});
