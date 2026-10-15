import { expect, test } from '@playwright/test';
import { marineBody, mockNetwork } from './mocks';

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

  test('expanded spot shows waves, water temperature and tide (fetched lazily)', async ({ page }) => {
    const marine: string[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith('https://marine-api.open-meteo.com/')) marine.push(r.url());
    });
    await page.goto('/gust/app/');
    await expect(page.getByText('Crissy Field')).toBeVisible();
    expect(marine).toHaveLength(0);
    await page.getByRole('button', { name: /Crissy Field/ }).click();
    const box = page.getByLabel('Marine conditions');
    await expect(box.getByText('1.2 m at 9 s from W')).toBeVisible();
    await expect(box.getByText(/16 °C · 4\/3 mm \(rough guide\)/)).toBeVisible();
    await expect(box.getByText(/^(Rising|Falling) · (high|low) \d\d:00$/)).toBeVisible();
    expect(marine).toHaveLength(1);
  });

  test('marine data with only nulls (inland) shows nothing', async ({ page }) => {
    await page.route('https://marine-api.open-meteo.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(marineBody(true)) }),
    );
    const done = page.waitForResponse((r) => r.url().startsWith('https://marine-api.open-meteo.com/'));
    await page.goto('/gust/app/');
    await page.getByRole('button', { name: /Crissy Field/ }).click();
    await done;
    await expect(page.getByText('Rideable from')).toBeVisible();
    await expect(page.getByLabel('Marine conditions')).toHaveCount(0);
    await expect(page.getByText('Water temp')).toHaveCount(0);
    await expect(page.getByText('Tide', { exact: true })).toHaveCount(0);
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

  test('favourite a spot: listed first with a star, persisted', async ({ page }) => {
    await page.goto('/gust/app/');
    await expect(page.getByText(/Updated \d/)).toBeVisible();
    const head = page.getByRole('button', { name: /Crissy Field/ });
    await head.click();
    const star = page.getByRole('button', { name: 'Favourite', exact: true });
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    const first = page.locator('section[aria-label="Near you"] li.spot').first();
    await expect(first).toContainText('Crissy Field');
    await expect(first.getByRole('img', { name: 'Favourite' })).toBeVisible();
    await page.reload();
    await expect(page.locator('section[aria-label="Near you"] li.spot').first().getByRole('img', { name: 'Favourite' })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gust.settings') ?? '{}').favorites)).toEqual(['crissy-field']);
  });

  test('favourites outside the radius get their own section', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('gust.settings', JSON.stringify({ favorites: ['kanaha'] })));
    await page.goto('/gust/app/');
    const fav = page.getByRole('region', { name: 'Favourites' });
    await expect(fav.getByRole('heading', { name: 'Favourites' })).toBeVisible();
    await expect(fav.locator('li.spot')).toHaveCount(1);
    await expect(fav.locator('li.spot .spot-wind strong')).toBeVisible();
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

test.describe('calendar export', () => {
  test.beforeEach(async ({ page, context }) => {
    await mockNetwork(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 37.8, longitude: -122.45 });
  });

  test('downloads an .ics with the upcoming good windows', async ({ page }) => {
    await page.goto('/gust/app/');
    await expect(page.getByText(/Updated \d/)).toBeVisible();
    await page.getByRole('tab', { name: 'Alerts' }).click();
    const button = page.getByRole('button', { name: 'Add good windows to calendar' });
    await expect(button).toBeEnabled();
    await expect(page.getByText(/re-export to refresh/)).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    expect(download.suggestedFilename()).toBe('gust-windows.ics');
    const path = await download.path();
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('\r\n');
    expect(raw.replace(/\r\n/g, '')).not.toContain('\n');
    const ics = raw.replace(/\r\n /g, '');
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain('SUMMARY:Wind on: Crissy Field (East Beach) (22 kn)');
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z\r\n/);
    expect(ics).toMatch(/DTEND:\d{8}T\d{6}Z\r\n/);
    expect(ics).toMatch(/UID:crissy-field-\d{8}T\d{6}Z@gust\.refcell\.github\.io/);
    expect(ics).toContain('https://refcell.github.io/gust/app/?spot=crissy-field');
    expect(ics).toMatch(/GEO:-?\d+\.\d+;-?\d+\.\d+/);
    expect(ics).toContain('gusts to 27 kn\\, from W (270°)');
    expect(ics).toMatch(/BEGIN:VALARM\r\nACTION:DISPLAY\r\n[^\r]+\r\nTRIGGER:-PT60M\r\nEND:VALARM/);
    // Mock wind is good 11:00-18:00 local (UTC-7) every day: 18:00Z-02:00Z.
    expect(ics).toMatch(/DTSTART:\d{8}T180000Z/);
  });

  test('installed iPhone app shares the .ics through the share sheet', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
      Object.defineProperty(navigator, 'standalone', { get: () => true });
      const w = window as unknown as { __shared?: Promise<string> };
      Object.defineProperty(navigator, 'canShare', { value: (d: { files?: File[] }) => !!d.files?.length });
      Object.defineProperty(navigator, 'share', {
        value: (d: { files: File[] }) => {
          w.__shared = d.files[0].text().then((t) => `${d.files[0].name}|${d.files[0].type}|${t}`);
          return Promise.resolve();
        },
      });
    });
    await page.goto('/gust/app/');
    await expect(page.getByText(/Updated \d/)).toBeVisible();
    await page.getByRole('tab', { name: 'Alerts' }).click();
    await page.getByRole('button', { name: 'Add good windows to calendar' }).click();
    const shared = await page.waitForFunction(() => (window as unknown as { __shared?: Promise<string> }).__shared).then(() =>
      page.evaluate(() => (window as unknown as { __shared: Promise<string> }).__shared),
    );
    expect(shared).toMatch(/^gust-windows\.ics\|text\/calendar[^|]*\|BEGIN:VCALENDAR/);
    expect(shared).toContain('BEGIN:VEVENT');
  });

  test('disables the button when there are no good windows', async ({ page }) => {
    // The mock's good runs last 8 hours; require 12.
    await page.addInitScript(() => localStorage.setItem('gust.settings', JSON.stringify({ minWindowHours: 12 })));
    await page.goto('/gust/app/');
    await expect(page.getByText(/Updated \d/)).toBeVisible();
    await page.getByRole('tab', { name: 'Alerts' }).click();
    await expect(page.getByRole('button', { name: 'No good windows in the next 48 h' })).toBeDisabled();
  });
});
