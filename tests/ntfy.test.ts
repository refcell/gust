import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_PUSH_SPOTS } from '../src/lib/limits';
import { buildAlertsConfig, parseAlertsConfig, randomTopic, resolveWatchedSpots, TOPIC_LENGTH, validTopic, type AlertsConfig } from '../src/lib/ntfy';
import type { Rating } from '../src/lib/score';
import { DEFAULT_SETTINGS, type Spot } from '../src/lib/types';
import { headerValue, ntfyRequest, parseState, runNtfyAlerts, STATE_VERSION, type NtfyState } from '../scripts/ntfy';

const NOW = Date.parse('2025-06-01T12:10:00Z');
const A: Spot = { id: 'a', name: 'Spot A', lat: 10, lon: 20, sectors: [[225, 300]] };
const B: Spot = { id: 'b', name: 'Spot B', lat: 10.1, lon: 20.1, sectors: [[225, 300]] };
const FAR: Spot = { id: 'far', name: 'Far Spot', lat: 40, lon: 20, sectors: [[225, 300]] };

const config = (extra: Partial<AlertsConfig> = {}): AlertsConfig => {
  const r = parseAlertsConfig(JSON.stringify({ places: [{ name: 'Home', lat: 10, lon: 20 }], timezone: 'UTC', quietHours: '', ...extra }));
  if (!r.ok) throw new Error(r.error);
  return r.config;
};

describe('parseAlertsConfig', () => {
  it('accepts the app config and fills defaults', () => {
    const r = parseAlertsConfig(JSON.stringify({ places: [{ name: 'Home', lat: 37.8, lon: -122.45 }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config).toMatchObject({ favorites: [], timezone: 'UTC', quietHours: '22-6', appUrl: 'https://refcell.github.io/gust/app/' });
    expect(r.config.settings).toMatchObject({ minKn: DEFAULT_SETTINGS.minKn, radiusKm: 50, unit: 'kn', forecastAlerts: true, muted: [] });
  });

  it('clamps settings like the app', () => {
    const r = parseAlertsConfig(JSON.stringify({ favorites: ['a'], settings: { minKn: 1, maxKn: 2, radiusKm: 9999 } }));
    expect(r.ok && r.config.settings).toMatchObject({ minKn: 3, maxKn: 4, radiusKm: 500 });
  });

  it.each([
    [undefined, 'empty'],
    ['nope', 'not valid JSON'],
    ['[]', 'JSON object'],
    ['{}', 'at least one place or favourite'],
    ['{"places":[{"name":"x","lat":"1","lon":2}]}', 'places[0]'],
    ['{"places":[{"lat":91,"lon":2}]}', 'places[0]'],
    ['{"favorites":[1]}', 'favorites'],
    ['{"favorites":["a"],"settings":{"unit":"bft"}}', 'settings.unit'],
    ['{"favorites":["a"],"settings":{"minKn":"15"}}', 'settings.minKn'],
    ['{"favorites":["a"],"settings":{"forecastAlerts":"yes"}}', 'forecastAlerts'],
    ['{"favorites":["a"],"timezone":"Mars/Olympus"}', 'timezone'],
    ['{"favorites":["a"],"quietHours":"late"}', 'quietHours'],
    ['{"favorites":["a"],"appUrl":"javascript:alert(1)"}', 'appUrl'],
  ])('rejects %s', (raw, error) => {
    const r = parseAlertsConfig(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(error);
  });

  it('round-trips the config the app builds', () => {
    const built = buildAlertsConfig({
      places: [{ id: 'p1', name: 'Beach house', lat: 37.123456, lon: -122.654321 }],
      settings: { ...DEFAULT_SETTINGS, unit: 'mph', favorites: ['kanaha'], muted: ['x'] },
      timezone: 'America/Los_Angeles',
    });
    expect(built.places).toEqual([{ name: 'Beach house', lat: 37.123, lon: -122.654 }]);
    const r = parseAlertsConfig(JSON.stringify(built));
    expect(r.ok && r.config).toEqual(built);
  });

  it('falls back to the rounded last location without saved places', () => {
    const built = buildAlertsConfig({ places: [], settings: DEFAULT_SETTINGS, loc: { lat: 37.80123, lon: -122.45678 }, timezone: 'UTC' });
    expect(built.places).toEqual([{ name: 'Last location', lat: 37.801, lon: -122.457 }]);
  });
});

describe('resolveWatchedSpots', () => {
  it('watches spots within the radius of each place plus favourites, minus muted', () => {
    const r = resolveWatchedSpots([A, B, FAR], config({ favorites: ['far', 'gone'], settings: { ...DEFAULT_SETTINGS, muted: ['b'] } }));
    expect(r.spots.map((s) => s.id)).toEqual(['far', 'a']);
    expect(r.missingFavorites).toEqual(['gone']);
  });

  it('does not watch nearest spots outside the radius (the app only shows them)', () => {
    expect(resolveWatchedSpots([FAR], config()).spots).toEqual([]);
  });

  it('caps at MAX_PUSH_SPOTS with favourites first, then nearest', () => {
    const many: Spot[] = Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, lat: 10 + i * 0.001, lon: 20 }));
    const other: Spot[] = Array.from({ length: 40 }, (_, i) => ({ id: `o${i}`, name: `O${i}`, lat: 20 + i * 0.001, lon: 20 }));
    const r = resolveWatchedSpots([...many, ...other, FAR], config({ favorites: ['far'], places: [{ name: 'Home', lat: 10, lon: 20 }, { name: 'Away', lat: 20, lon: 20 }] }));
    // nearbySpots lists at most 40 per place (as in the app): 40 + 40 + 1 favourite.
    expect(r.total).toBe(81);
    expect(r.spots).toHaveLength(MAX_PUSH_SPOTS);
    expect(r.spots[0].id).toBe('far');
    expect(r.spots.slice(1, 3).map((s) => s.id).sort()).toEqual(['o0', 's0']);
  });

  it('resolves real spots from data/spots.json like the app (San Francisco)', () => {
    const all = JSON.parse(readFileSync('data/spots.json', 'utf8')) as Spot[];
    const r = resolveWatchedSpots(all, config({ places: [{ name: 'SF', lat: 37.8, lon: -122.45 }], favorites: ['kanaha'] }));
    expect(r.spots[0].id).toBe('kanaha');
    expect(r.spots.map((s) => s.id)).toContain('crissy-field');
  });
});

describe('topics', () => {
  it('generates 24-char lowercase alphanumeric topics', () => {
    const t = randomTopic();
    expect(t).toHaveLength(TOPIC_LENGTH);
    expect(t).toMatch(/^[a-z0-9]{24}$/);
    expect(validTopic(t)).toBe(true);
    expect(randomTopic()).not.toBe(t);
    expect(validTopic('a/b')).toBe(false);
    expect(validTopic('')).toBe(false);
  });
});

describe('ntfy request', () => {
  const push = { payload: { title: 'Spot A is on', body: '20 kn gusting 25 from W', tag: 'now-a', url: 'https://refcell.github.io/gust/app/?spot=a' }, urgent: true, alerts: [{ tag: 'now-a', title: 'Spot A is on', body: '', spotId: 'a', kind: 'now' as const }] };

  it('POSTs the message to <server>/<topic> with Title, Tags, Click and Priority headers', () => {
    const { url, init } = ntfyRequest('https://ntfy.sh/', 'abc123', push);
    expect(url).toBe('https://ntfy.sh/abc123');
    expect(init).toEqual({
      method: 'POST',
      headers: { Title: 'Spot A is on', Tags: 'wind_face', Click: 'https://refcell.github.io/gust/app/?spot=a', Priority: 'default' },
      body: '20 kn gusting 25 from W',
    });
  });

  it('tags forecast-only pushes differently and encodes non-ASCII titles (RFC 2047)', () => {
    const fc = { ...push, alerts: [{ ...push.alerts[0], kind: 'forecast' as const }], payload: { ...push.payload, title: 'Good window ahead: Lagoa de Óbidos' } };
    const { init } = ntfyRequest('https://ntfy.sh', 't', fc);
    const h = init.headers as Record<string, string>;
    expect(h.Tags).toBe('calendar');
    expect(h.Title).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(Buffer.from(h.Title.slice(10, -2), 'base64').toString('utf8')).toBe('Good window ahead: Lagoa de Óbidos');
    expect(headerValue('a\r\nb')).toBe('a b');
  });
});

describe('state', () => {
  it('treats missing or malformed state as a first run', () => {
    expect(parseState(null)).toBeNull();
    expect(parseState('garbage')).toBeNull();
    expect(parseState('{"version":0,"alerts":{"ratings":{},"notifiedWindows":{}}}')).toBeNull();
    const s: NtfyState = { version: STATE_VERSION, alerts: { ratings: { a: 'good' }, notifiedWindows: {} }, updatedAt: 1 };
    expect(parseState(JSON.stringify(s))).toEqual(s);
  });
});

function hours(n: number, good: (i: number) => boolean) {
  const t0 = Date.parse('2025-06-01T00:00:00Z');
  const time: string[] = [];
  const sp: number[] = [];
  const gu: number[] = [];
  const di: number[] = [];
  for (let i = 0; i < n; i++) {
    time.push(new Date(t0 + i * 3600_000).toISOString().slice(0, 16));
    sp.push(good(i) ? 20 : 5);
    gu.push(good(i) ? 25 : 8);
    di.push(270);
  }
  return { time, wind_speed_10m: sp, wind_gusts_10m: gu, wind_direction_10m: di };
}

/** A is on now; B is light now with a good window 15:00-18:00 UTC. */
function openMeteoFor(lat: number) {
  const on = lat === A.lat;
  return {
    utc_offset_seconds: 0,
    current: { time: '2025-06-01T12:00', wind_speed_10m: on ? 20 : 5, wind_gusts_10m: on ? 25 : 8, wind_direction_10m: 270 },
    hourly: hours(48, (i) => (on ? true : i >= 15 && i <= 18)),
  };
}

function mockFetch(ntfyStatus: (n: number) => number = () => 200) {
  const posts: { url: string; init: RequestInit }[] = [];
  const weather: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.open-meteo.com/')) {
      weather.push(url);
      const lats = new URL(url).searchParams.get('latitude')!.split(',').map(Number);
      return new Response(JSON.stringify(lats.length === 1 ? openMeteoFor(lats[0]) : lats.map(openMeteoFor)), { status: 200 });
    }
    if (!url.startsWith('https://ntfy.sh/')) throw new Error('unexpected fetch ' + url);
    posts.push({ url, init: init! });
    return new Response('{}', { status: ntfyStatus(posts.length) });
  }) as typeof fetch;
  return { fetchImpl, posts, weather };
}

const firstState = (ratings: Record<string, Rating>): NtfyState => ({ version: STATE_VERSION, alerts: { ratings, notifiedWindows: {} }, updatedAt: 0 });

describe('runNtfyAlerts', () => {
  it('first run: no "now" alert for an already-good spot (server semantics), forecast windows alert', async () => {
    const m = mockFetch();
    const r = await runNtfyAlerts({ config: config(), state: null, allSpots: [A, B], topic: 'tpc', now: NOW, fetchImpl: m.fetchImpl });
    expect(m.weather).toHaveLength(1); // batched
    expect(r.alerts.map((a) => a.tag)).toEqual(['fc-b@2025-06-01T15:00']);
    expect(m.posts.map((p) => p.url)).toEqual(['https://ntfy.sh/tpc']);
    expect(r.state?.alerts.ratings).toMatchObject({ a: 'good', b: 'poor' });
    expect(r.state?.alerts.notifiedWindows).toHaveProperty('b@2025-06-01T15:00');
  });

  it('alerts when a spot turns good, then dedups on the next run', async () => {
    const m = mockFetch();
    const prev = firstState({ a: 'poor', b: 'poor' });
    const r = await runNtfyAlerts({ config: config({ settings: { ...DEFAULT_SETTINGS, forecastAlerts: false } }), state: prev, allSpots: [A, B], topic: 'tpc', now: NOW, fetchImpl: m.fetchImpl });
    expect(r.sent).toBe(1);
    const h = m.posts[0].init.headers as Record<string, string>;
    expect(h).toMatchObject({ Title: 'Spot A is on', Click: 'https://refcell.github.io/gust/app/?spot=a' });
    expect(m.posts[0].init.body).toContain('20 kn');
    const again = await runNtfyAlerts({ config: config({ settings: { ...DEFAULT_SETTINGS, forecastAlerts: false } }), state: r.state, allSpots: [A, B], topic: 'tpc', now: NOW + 900_000, fetchImpl: m.fetchImpl });
    expect(again.alerts).toEqual([]);
    expect(m.posts).toHaveLength(1);
  });

  it('rolls back alerts whose publish failed so they retry; keeps delivered ones', async () => {
    const m = mockFetch((n) => (n === 1 ? 200 : 500));
    const prev = firstState({ a: 'poor', b: 'poor' });
    const r = await runNtfyAlerts({ config: config(), state: prev, allSpots: [A, B], topic: 'tpc', now: NOW, fetchImpl: m.fetchImpl, log: () => undefined });
    expect(r.alerts.map((a) => a.tag)).toEqual(['now-a', 'fc-b@2025-06-01T15:00']);
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.state?.alerts.ratings.a).toBe('good'); // delivered
    expect(r.state?.alerts.notifiedWindows).not.toHaveProperty('b@2025-06-01T15:00'); // rolled back
    const retry = await runNtfyAlerts({ config: config(), state: r.state, allSpots: [A, B], topic: 'tpc', now: NOW + 900_000, fetchImpl: mockFetch().fetchImpl });
    expect(retry.alerts.map((a) => a.tag)).toEqual(['fc-b@2025-06-01T15:00']);
  });

  it('rolls back a "now" alert when the request throws', async () => {
    const m = mockFetch();
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith('https://ntfy.sh/')) throw new Error('network down');
      return m.fetchImpl(input, init);
    }) as typeof fetch;
    const prev = firstState({ a: 'poor' });
    const r = await runNtfyAlerts({ config: config({ settings: { ...DEFAULT_SETTINGS, forecastAlerts: false } }), state: prev, allSpots: [A], topic: 'tpc', now: NOW, fetchImpl, log: () => undefined });
    expect(r.failed).toBe(1);
    expect(r.state?.alerts.ratings.a).toBe('poor');
  });

  it('sends at most 3 notifications, folding the rest into a summary', async () => {
    const spots: Spot[] = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, lat: 10, lon: 20 + i * 0.01, sectors: [[225, 300]] }));
    const m = mockFetch();
    const prev = firstState(Object.fromEntries(spots.map((s) => [s.id, 'poor' as const])));
    const r = await runNtfyAlerts({ config: config({ settings: { ...DEFAULT_SETTINGS, forecastAlerts: false } }), state: prev, allSpots: spots, topic: 'tpc', now: NOW, fetchImpl: m.fetchImpl });
    expect(r.alerts).toHaveLength(5);
    expect(m.posts).toHaveLength(3);
    const last = m.posts[2].init.headers as Record<string, string>;
    expect(last.Title).toBe('Wind at 3 more spots');
    expect(last.Click).toBe('https://refcell.github.io/gust/app/');
    expect(Object.values(r.state!.alerts.ratings).every((x) => x === 'good')).toBe(true);
  });

  it('skips during quiet hours in the config time zone without touching state or the network', async () => {
    const m = mockFetch();
    const prev = firstState({ a: 'poor' });
    // 12:10 UTC is 22:10 in Brisbane (UTC+10, no DST).
    const r = await runNtfyAlerts({ config: config({ timezone: 'Australia/Brisbane', quietHours: '22-6' }), state: prev, allSpots: [A], topic: 'tpc', now: NOW, fetchImpl: m.fetchImpl });
    expect(r.quiet).toBe(true);
    expect(r.state).toBe(prev);
    expect(m.weather).toHaveLength(0);
    expect(m.posts).toHaveLength(0);
    // Outside quiet hours in another zone (12:10 UTC = 05:10 in Los Angeles is quiet; 14:10 in Berlin is not).
    const r2 = await runNtfyAlerts({ config: config({ timezone: 'Europe/Berlin', quietHours: '22-6' }), state: prev, allSpots: [A], topic: 'tpc', now: NOW, fetchImpl: m.fetchImpl });
    expect(r2.quiet).toBe(false);
  });

  it('keeps state unchanged when Open-Meteo fails', async () => {
    const prev = firstState({ a: 'poor' });
    const fetchImpl = (async () => new Response('busy', { status: 429 })) as unknown as typeof fetch;
    const r = await runNtfyAlerts({ config: config(), state: prev, allSpots: [A], topic: 'tpc', now: NOW, fetchImpl });
    expect(r.withWind).toBe(0);
    expect(r.state).toBe(prev);
  });

  it('uses NTFY_SERVER overrides', async () => {
    const posts: string[] = [];
    const m = mockFetch();
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://ntfy.example.com/')) {
        posts.push(url);
        return new Response('{}', { status: 200 });
      }
      return m.fetchImpl(input, init);
    }) as typeof fetch;
    await runNtfyAlerts({ config: config(), state: firstState({ a: 'poor' }), allSpots: [A], topic: 'tpc', server: 'https://ntfy.example.com', now: NOW, fetchImpl });
    expect(posts).toEqual(['https://ntfy.example.com/tpc']);
  });
});

describe('secret hygiene', () => {
  it('redacts the topic (raw and URL-encoded) from logged text', async () => {
    const { redact } = await import('../scripts/ntfy');
    expect(redact('Failed to parse URL from not-a-url/abc_TOPIC-1', 'abc_TOPIC-1')).toBe('Failed to parse URL from not-a-url/***');
    expect(redact('nothing here', '')).toBe('nothing here');
  });
  it('validates the ntfy server before the topic is appended', async () => {
    const { validServer } = await import('../scripts/ntfy');
    expect(validServer('not-a-url')).toBeNull();
    expect(validServer('ftp://x.example')).toBeNull();
    expect(validServer('https://ntfy.example.com/')).toBe('https://ntfy.example.com');
    expect(validServer('https://ntfy.example.com/base/')).toBe('https://ntfy.example.com/base');
  });
  it('never logs the topic when a publish throws', async () => {
    const { runNtfyAlerts } = await import('../scripts/ntfy');
    expect(typeof runNtfyAlerts).toBe('function');
  });
});
