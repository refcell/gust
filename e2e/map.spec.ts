import { expect, test } from '@playwright/test';
import { mockNetwork } from './mocks';

test.describe('map view', () => {
  test.beforeEach(async ({ page, context }) => {
    await mockNetwork(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 37.8, longitude: -122.45 });
  });

  test('switch to map, tap a marker, open details in the list', async ({ page }) => {
    const tiles: string[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith('https://tile.openstreetmap.org/')) tiles.push(r.url());
    });
    await page.goto('/gust/app/');
    await expect(page.getByText(/Updated \d/)).toBeVisible();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-pressed', 'true');

    const map = page.getByRole('region', { name: 'Map of nearby spots' });
    await expect(map).toBeVisible();
    await expect(map.getByRole('link', { name: '© OpenStreetMap contributors' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    await expect(map.getByRole('img', { name: 'Your location' })).toBeVisible();
    const markers = map.locator('button.map-marker');
    expect(await markers.count()).toBeGreaterThan(1);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((u) => /\/\d+\/\d+\/\d+\.png$/.test(u))).toBe(true);

    const crissy = map.getByRole('button', { name: /^Crissy Field[^,]*, (Good|OK|Light|Strong|Offshore|No wind), / });
    // Markers around the city are clustered at the initial (radius-wide) zoom: tap the cluster
    // containing Crissy Field until its own marker shows.
    const cluster = map.locator('button.map-cluster[data-spots~="crissy-field"]');
    await expect(cluster).toHaveAttribute('aria-label', /^\d+ spots, best (Good|OK|Light|Strong|No wind|Offshore)\b.*\. Zoom in$/);
    await expect(cluster.locator('.map-pin')).toHaveText(/^\d+$/);
    for (let i = 0; i < 6 && (await crissy.count()) === 0; i++) {
      await cluster.click();
      await expect(async () => expect((await crissy.count()) + (await cluster.count())).toBeGreaterThan(0)).toPass();
    }
    // Rating is conveyed as text, not colour alone.
    await expect(crissy.locator('.map-pin')).toHaveText(/\S/);
    await crissy.click();
    await expect(crissy).toHaveAttribute('aria-pressed', 'true');
    const card = page.getByRole('region', { name: /^Selected: Crissy Field/ });
    await expect(card).toContainText(/\d+\/100/);

    // Zoom out keeps the selection card.
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Open details' }).click();
    await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const head = page.locator('li.spot', { hasText: 'Crissy Field' }).getByRole('button', { name: /Crissy Field/ });
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await expect(head).toBeFocused();
    await expect(head).toBeInViewport();
  });

  test('remembers the map choice and supports keyboard', async ({ page, browserName }) => {
    await page.goto('/gust/app/');
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.locator('button.map-marker').first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Map of nearby spots' })).toBeVisible();
    await expect(page.locator('button.map-marker').first()).toBeVisible();

    // WebKit does not Tab to buttons by default; focus directly there.
    const first = page.locator('button.map-marker').first();
    if (browserName === 'webkit') await first.focus();
    else {
      await page.getByRole('button', { name: 'Map', exact: true }).focus();
      await page.keyboard.press('Tab');
      // The map surface itself is focusable (keyboard panning), then its markers.
      await expect(page.getByRole('region', { name: 'Map of nearby spots' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(first).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.locator('button.map-marker').nth(1)).toBeFocused();
      await page.keyboard.press('Shift+Tab');
    }
    // Enter on a cluster zooms in and keeps focus on a marker of that cluster.
    for (let i = 0; i < 8 && (await page.evaluate(() => document.activeElement?.classList.contains('map-cluster'))); i++) {
      await page.keyboard.press('Enter');
      await expect(page.locator('button.map-marker:focus')).toHaveCount(1);
    }
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Open details' })).toBeVisible();
  });

  test('drag pans the map without selecting', async ({ page }) => {
    await page.goto('/gust/app/');
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    const marker = page.locator('button.map-marker').first();
    await expect(marker).toBeVisible();
    const before = await marker.boundingBox();
    const box = (await page.locator('.map').boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + box.height - 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + box.height - 40, { steps: 5 });
    await page.mouse.up();
    const after = await page.locator(`button.map-marker[aria-label="${await marker.getAttribute('aria-label')}"]`).boundingBox();
    expect(after && before && Math.round(after.x - before.x)).toBe(60);
    await expect(page.getByRole('button', { name: 'Open details' })).toHaveCount(0);
  });

  test('arrow keys pan and +/- zoom the focused map', async ({ page }) => {
    await page.goto('/gust/app/');
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    const map = page.getByRole('region', { name: 'Map of nearby spots' });
    const dot = map.getByRole('img', { name: 'Your location' });
    await expect(dot).toBeVisible();
    const before = (await dot.boundingBox())!;
    await map.focus();
    await expect(map).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(async () => {
      const after = (await dot.boundingBox())!;
      // The view moved right and down, so content shifts left and up.
      expect(after.x).toBeLessThan(before.x - 20);
      expect(after.y).toBeLessThan(before.y - 20);
    }).toPass();
    await expect(map).toBeFocused();
    const radius = page.locator('.map-radius');
    const r0 = (await radius.boundingBox())!.width;
    await page.keyboard.press('-');
    await expect(async () => expect((await radius.boundingBox())!.width).toBeLessThan(r0 * 0.75)).toPass();
    // Markers still work with the keyboard after panning.
    const marker = map.locator('button.map-marker').first();
    await marker.focus();
    await page.keyboard.press('ArrowRight');
    await expect(marker).toBeFocused();
  });
});
