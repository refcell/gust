import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockNetwork } from './mocks';

/** Accessibility audit with axe-core. Fails on serious or critical WCAG 2.1 A/AA violations. */
async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map((v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.map((n) => `  ${JSON.stringify(n.target)} ${n.failureSummary ?? ''}`).join('\n')}`).join('\n');
  expect(bad, `${label}\n${report}`).toEqual([]);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`a11y (${colorScheme})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await mockNetwork(page);
    });

    test('landing page', async ({ page }) => {
      await page.goto('/gust/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await audit(page, 'landing');
    });

    test('first-run welcome', async ({ page }) => {
      await page.goto('/gust/app/');
      await expect(page.getByRole('button', { name: 'Share location' })).toBeVisible();
      await audit(page, 'welcome');
    });

    test('app tabs', async ({ page, context }) => {
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation({ latitude: 37.8, longitude: -122.45 });
      await page.goto('/gust/app/');
      await page.getByRole('button', { name: /Crissy Field/ }).click();
      await expect(page.getByRole('img', { name: /Wind for the next 48 hours/ })).toBeVisible();
      await audit(page, 'spots (expanded)');

      await page.getByRole('button', { name: 'Map', exact: true }).click();
      const crissy = page.getByRole('button', { name: /^Crissy Field[^,]*, / });
      const cluster = page.locator('button.map-cluster[data-spots~="crissy-field"]');
      await expect(crissy.or(cluster)).toBeVisible();
      await audit(page, 'spots map (clusters)');
      for (let i = 0; i < 6 && (await crissy.count()) === 0; i++) {
        await cluster.click();
        await expect(crissy.or(cluster)).toBeVisible();
      }
      await crissy.click();
      await expect(page.getByRole('button', { name: 'Open details' })).toBeVisible();
      await audit(page, 'spots map (selected)');
      await page.getByRole('button', { name: 'List', exact: true }).click();

      for (const name of ['Settings', 'Alerts', 'Places']) {
        await page.getByRole('tab', { name }).click();
        await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
        await audit(page, name);
      }
      // Places search with spot matches on screen.
      await page.locator('#place-q').fill('hood');
      await page.locator('#place-q').press('Enter');
      await expect(page.getByRole('list', { name: 'Matching spots' })).toBeVisible();
      await audit(page, 'places search (spot matches)');
    });
  });
}
