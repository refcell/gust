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
    await expect(page.locator('.spot-detail').getByRole('img', { name: /Wind from/ })).toBeVisible();
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

  test('demo mode neither reads nor writes the user state', async ({ page }) => {
    // Seed a user state on a same-origin page that does not run the app.
    await page.goto('/gust/manifest.webmanifest');
    await page.evaluate(async () => {
      localStorage.setItem('gust.settings', JSON.stringify({ unit: 'mph', favorites: ['kanaha'], muted: ['crissy-field'] }));
      localStorage.setItem('gust.places', JSON.stringify([{ id: 'p1', name: 'Maui', lat: 20.9, lon: -156.43 }]));
      localStorage.setItem('gust.favSpots', JSON.stringify([{ id: 'kanaha', name: 'Kanaha', lat: 20.9, lon: -156.43, sectors: [[0, 90]] }]));
      localStorage.setItem('gust.lastLocation', JSON.stringify({ lat: 20.9, lon: -156.43, at: 1 }));
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('gust', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        const kv = tx.objectStore('kv');
        kv.put({ ratings: { kanaha: 'light' }, notifiedWindows: { 'kanaha@2025-01-01T10:00/2025-01-01T12:00': 1 } }, 'alertState');
        kv.put([{ id: 'kanaha', name: 'Kanaha', lat: 20.9, lon: -156.43, sectors: [[0, 90]] }], 'watchSpots');
        kv.put({ unit: 'mph' }, 'settings');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    const snapshot = () =>
      page.evaluate(async () => {
        const ls: Record<string, string | null> = {};
        for (let i = 0; i < localStorage.length; i++) ls[localStorage.key(i)!] = localStorage.getItem(localStorage.key(i)!);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('gust', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const kv: Record<string, unknown> = {};
        await new Promise<void>((resolve, reject) => {
          const req = db.transaction('kv').objectStore('kv').openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (!c) return resolve();
            kv[String(c.key)] = c.value;
            c.continue();
          };
          req.onerror = () => reject(req.error);
        });
        db.close();
        return { ls, kv };
      });
    const before = await snapshot();
    await page.addInitScript(() => {
      const w = window as unknown as { __permRequests: number };
      w.__permRequests = 0;
      if ('Notification' in window)
        Notification.requestPermission = async () => {
          w.__permRequests++;
          return 'denied';
        };
    });

    await page.goto('/gust/app/?demo=1');
    await expect(page.getByText('Demo mode')).toBeVisible();
    await expect(page.getByText(/Updated \d/)).toBeVisible();
    // Default settings and no saved places or favourites from storage.
    // 22 kn in the mocks (the seeded mph setting would show 25).
    await expect(page.locator('.spot-wind strong').first()).toHaveText('22');
    await expect(page.getByRole('heading', { name: /Maui/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Favourites' })).toHaveCount(0);
    // Interact: favourite, mute, change units, open the alerts tab. None of it is persisted.
    await page.getByRole('button', { name: /Crissy Field/ }).click();
    await page.getByRole('button', { name: 'Favourite', exact: true }).click();
    await page.getByRole('button', { name: 'Mute alerts' }).click();
    await page.getByRole('tab', { name: 'Alerts' }).click();
    await expect(page.getByText('Alerts are off in the demo.')).toBeVisible();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByText('m/s', { exact: true }).click();
    await page.getByRole('tab', { name: 'Spots' }).click();
    await page.getByRole('button', { name: 'Map' }).click();
    await page.getByRole('button', { name: 'List' }).click();
    await page.getByRole('button', { name: 'Refresh wind' }).click();
    await expect(page.getByText(/Updated \d/)).toBeVisible();
    // Past the background-sync debounce (1.5 s).
    await page.waitForTimeout(2000);
    expect(await snapshot()).toEqual(before);
    expect(await page.evaluate(() => (window as unknown as { __permRequests: number }).__permRequests)).toBe(0);
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

  test('places search finds curated spots by name; favouriting watches them outside the radius', async ({ page }) => {
    // Geocoding is down: spot matches still show.
    await page.route('https://geocoding-api.open-meteo.com/**', (route) => route.fulfill({ status: 500, body: '' }));
    await page.goto('/gust/app/');
    await expect(page.getByText(/Updated \d/)).toBeVisible();
    await page.getByRole('tab', { name: 'Places' }).click();
    await page.locator('#place-q').fill('hood');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const list = page.getByRole('list', { name: 'Matching spots' });
    await expect(list).toContainText('Hood River Event Site');
    await expect(list).toContainText('The Hook (Hood River)');
    await expect(list).toContainText('OR, US');
    await expect(page.getByText('Search failed. Check your connection.')).toBeVisible();
    await expect(page.getByText(/appear in your list once you favourite them/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show Hood River Event Site' })).toHaveCount(0);
    const fav = page.getByRole('button', { name: 'Favourite Hood River Event Site' });
    await expect(fav).toHaveAttribute('aria-pressed', 'false');
    await fav.click();
    await expect(fav).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gust.favSpots') ?? '[]').map((s: { id: string }) => s.id))).toEqual(['hood-river-event-site']);
    await page.getByRole('button', { name: 'Show Hood River Event Site' }).click();
    await expect(page.getByRole('tab', { name: 'Spots' })).toHaveAttribute('aria-selected', 'true');
    const favs = page.getByRole('region', { name: 'Favourites' });
    const item = favs.locator('li.spot', { hasText: 'Hood River Event Site' });
    await expect(item.getByRole('img', { name: 'Favourite' })).toBeVisible();
    await expect(item.locator('.spot-head')).toBeFocused();
    await expect(item).toBeInViewport();
  });

  test('alerts panel explains platform support', async ({ page }) => {
    await page.goto('/gust/app/');
    await page.getByRole('tab', { name: 'Alerts' }).click();
    await expect(page.getByRole('heading', { name: 'On this device' })).toBeVisible();
  });

  test('alerts panel builds the ntfy alert config and a private topic', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('gust.places', JSON.stringify([{ id: 'p1', name: 'Hood River', lat: 45.7, lon: -121.5 }]));
      localStorage.setItem('gust.settings', JSON.stringify({ favorites: ['kanaha'], unit: 'mph' }));
      // Stub the clipboard (permissions differ per engine); keep the copied text for the test.
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void w.__copied.push(t) } });
    });
    await page.goto('/gust/app/');
    await page.getByRole('tab', { name: 'Alerts' }).click();
    await page.getByText('Background alerts with ntfy').click();

    await page.getByRole('button', { name: 'Copy alert config' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Alert config copied.' })).toBeVisible();
    const copied = () => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
    const config = JSON.parse((await copied())[0]);
    expect(config.places).toEqual([{ name: 'Hood River', lat: 45.7, lon: -121.5 }]);
    expect(config.favorites).toEqual(['kanaha']);
    expect(config.settings).toMatchObject({ unit: 'mph', minKn: 15, radiusKm: 50 });
    expect(typeof config.timezone).toBe('string');

    await page.getByRole('button', { name: 'Generate topic' }).click();
    const topic = (await page.locator('.ntfy-topic').textContent()) ?? '';
    expect(topic).toMatch(/^[a-z0-9]{24}$/);
    expect(await page.evaluate(() => localStorage.getItem('gust.ntfyTopic'))).toBe(topic);
    await page.getByRole('button', { name: 'Copy topic' }).click();
    expect((await copied())[1]).toBe(topic);
    // The topic stays on the device: never part of the config.
    expect((await copied())[0]).not.toContain(topic);
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
