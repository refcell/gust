import { describe, expect, it } from 'vitest';
import type { AlertState } from '../../src/lib/alerts';
import { DEFAULT_SETTINGS } from '../../src/lib/types';
import type { Alert } from '../../src/lib/alerts';
import { buildPayloads, inQuietHours, localHour, MAX_PER_SUBSCRIBER, rollback, runCron } from '../src/cron';
import worker from '../src/index';
import { endpointId, putState, putSubscriber } from '../src/store';
import type { Subscriber, SubSpot } from '../src/validate';
import { decrypt, makeEnv, makeReceiver, type Receiver } from './helpers';

const NOW = Date.parse('2025-06-01T12:10:00Z');
const A: SubSpot = { id: 'a', name: 'Spot A', lat: 10, lon: 20, sectors: [[225, 300]] };
const B: SubSpot = { id: 'b', name: 'Spot B', lat: 11, lon: 21, sectors: [[225, 300]] };

function hours(from: string, n: number, good: (i: number) => boolean) {
  const t0 = Date.parse(from + ':00Z');
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

/** A is on now; B is light now with a good window 15:00-18:00. */
function openMeteoFor(lat: number) {
  const on = lat === A.lat;
  return {
    utc_offset_seconds: 0,
    current: { time: '2025-06-01T12:00', wind_speed_10m: on ? 20 : 5, wind_gusts_10m: on ? 25 : 8, wind_direction_10m: 270 },
    hourly: hours('2025-06-01T00:00', 48, (i) => (on ? true : i >= 15 && i <= 18)),
  };
}

interface Mock {
  fetch: typeof fetch;
  weatherCalls: string[];
  pushes: { endpoint: string; headers: Record<string, string>; payload: string }[];
}

function mockFetch(receivers: Receiver[], status: Record<string, number> = {}): Mock {
  const m: Mock = { weatherCalls: [], pushes: [], fetch: undefined as unknown as typeof fetch };
  m.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.open-meteo.com/')) {
      m.weatherCalls.push(url);
      const lats = new URL(url).searchParams.get('latitude')!.split(',').map(Number);
      const body = lats.length === 1 ? openMeteoFor(lats[0]) : lats.map(openMeteoFor);
      return new Response(JSON.stringify(body), { status: 200 });
    }
    const r = receivers.find((x) => x.sub.endpoint === url);
    if (!r) throw new Error('unexpected fetch ' + url);
    const headers = init!.headers as Record<string, string>;
    m.pushes.push({ endpoint: url, headers, payload: await decrypt(init!.body as Uint8Array, r) });
    return new Response(null, { status: status[url] ?? 201 });
  }) as typeof fetch;
  return m;
}

function subscriber(r: Receiver, spots: SubSpot[], tz = 'UTC'): Subscriber {
  return { subscription: r.sub, settings: { ...DEFAULT_SETTINGS }, location: null, spots, tz, updatedAt: 0 };
}

describe('quiet hours', () => {
  it('parses wrapping and non-wrapping ranges', () => {
    expect(inQuietHours(23, '22-6')).toBe(true);
    expect(inQuietHours(3, '22-6')).toBe(true);
    expect(inQuietHours(6, '22-6')).toBe(false);
    expect(inQuietHours(12, '22-6')).toBe(false);
    expect(inQuietHours(13, '12-14')).toBe(true);
    expect(inQuietHours(14, '12-14')).toBe(false);
    expect(inQuietHours(3, '')).toBe(false);
    expect(inQuietHours(3, 'garbage')).toBe(false);
  });
  it('computes the local hour in a time zone', () => {
    expect(localHour(NOW, 'UTC')).toBe(12);
    expect(localHour(NOW, 'Asia/Tokyo')).toBe(21);
    expect(localHour(Date.parse('2025-06-01T16:00:00Z'), 'Asia/Tokyo')).toBe(1);
  });
});

describe('buildPayloads', () => {
  const fc = (id: string): Alert => ({ tag: `fc-${id}`, kind: 'forecast', spotId: id, title: `Good window ahead: ${id.toUpperCase()}`, body: 'b' });
  const now = (id: string): Alert => ({ tag: `now-${id}`, kind: 'now', spotId: id, title: `${id.toUpperCase()} is on`, body: 'b' });
  const app = 'https://x.test/app/';

  it('sends each alert when within the per-subscriber limit', () => {
    const out = buildPayloads([fc('a'), now('b')], app);
    expect(out.map((o) => o.payload.tag)).toEqual(['now-b', 'fc-a']);
    expect(out[0]).toEqual({ payload: { title: 'B is on', body: 'b', tag: 'now-b', url: 'https://x.test/app/?spot=b' }, urgent: true, alerts: [now('b')] });
    expect(out[1].urgent).toBe(false);
  });

  it('folds overflow into one summary notification', () => {
    const out = buildPayloads([fc('a'), fc('b'), fc('c'), now('d'), fc('e')], app);
    expect(out).toHaveLength(MAX_PER_SUBSCRIBER);
    expect(out.map((o) => o.payload.tag)).toEqual(['now-d', 'fc-a', 'gust-summary']);
    expect(out[2].payload).toEqual({ title: 'Wind at 3 more spots', body: 'B, C, E', tag: 'gust-summary', url: app });
    expect(out[2].urgent).toBe(false);
    // Each push records which alerts it represents (the summary stands for the overflow).
    expect(out.map((o) => o.alerts.map((a) => a.tag))).toEqual([['now-d'], ['fc-a'], ['fc-b', 'fc-c', 'fc-e']]);
  });
});

describe('rollback', () => {
  it('undoes only the undelivered alerts', () => {
    const prev: AlertState = { ratings: { a: 'light', b: 'ok' }, notifiedWindows: {} };
    const next: AlertState = { ratings: { a: 'good', b: 'good', c: 'good' }, notifiedWindows: { 'x@1': NOW, 'y@2': NOW } };
    const alerts: Alert[] = [
      { tag: 'now-a', kind: 'now', spotId: 'a', title: '', body: '' },
      { tag: 'now-c', kind: 'now', spotId: 'c', title: '', body: '' },
      { tag: 'fc-y@2', kind: 'forecast', spotId: 'y', title: '', body: '' },
    ];
    expect(rollback(prev, next, alerts)).toEqual({ ratings: { a: 'light', b: 'good' }, notifiedWindows: { 'x@1': NOW } });
  });
});

describe('runCron', () => {
  it('pushes alerts, persists state, dedupes weather fetches, and removes gone subscriptions', async () => {
    const env = await makeEnv();
    const r1 = await makeReceiver('https://push.example.com/one');
    const r2 = await makeReceiver('https://push.example.com/two');
    const id1 = await putSubscriber(env.SUBS, subscriber(r1, [A, B]));
    const id2 = await putSubscriber(env.SUBS, subscriber(r2, [A]));
    // Subscriber 1 previously saw A as light, so A turning good is a transition.
    const prev: AlertState = { ratings: { a: 'light', b: 'poor' }, notifiedWindows: {} };
    await putState(env.SUBS, id1, prev);
    await putState(env.SUBS, id2, prev);

    const m = mockFetch([r1, r2], { [r2.sub.endpoint]: 410 });
    const report = await runCron(env, NOW, m.fetch);

    // One Open-Meteo call for both subscribers (A deduplicated).
    expect(m.weatherCalls).toHaveLength(1);
    expect(new URL(m.weatherCalls[0]).searchParams.get('latitude')).toBe('10.0000,11.0000');

    const one = m.pushes.filter((p) => p.endpoint === r1.sub.endpoint).map((p) => JSON.parse(p.payload));
    expect(one).toEqual([
      { title: 'Spot A is on', body: '20 kn gusting 25 from W', tag: 'now-a', url: 'https://refcell.github.io/gust/app/?spot=a' },
      {
        title: 'Good window ahead: Spot B',
        body: 'Today 15:00 for 4h, avg 20 kn',
        tag: 'fc-b@2025-06-01T15:00/2025-06-01T18:00',
        url: 'https://refcell.github.io/gust/app/?spot=b',
      },
    ]);
    const h = m.pushes[0].headers;
    expect(h.Urgency).toBe('high');
    expect(h.Authorization).toMatch(/^vapid t=.+, k=/);

    expect(report).toMatchObject({ subscribers: 2, alerts: 3, sent: 2, removed: 1 });
    // 410 deleted subscriber 2 and its state.
    expect(env.SUBS.map.has('sub:' + id2)).toBe(false);
    expect(env.SUBS.map.has('state:' + id2)).toBe(false);
    // Subscriber 1 state updated.
    const st = JSON.parse(env.SUBS.map.get('state:' + id1)!) as AlertState;
    expect(st.ratings).toEqual({ a: 'good', b: 'poor' });
    expect(Object.keys(st.notifiedWindows)).toEqual(['b@2025-06-01T15:00/2025-06-01T18:00']);

    // Next run: nothing new, and no KV writes.
    const writes = env.SUBS.writes;
    const m2 = mockFetch([r1]);
    const report2 = await runCron(env, NOW + 30 * 60_000, m2.fetch);
    expect(m2.pushes).toHaveLength(0);
    expect(report2).toMatchObject({ subscribers: 1, alerts: 0, sent: 0 });
    expect(env.SUBS.writes).toBe(writes);
  });

  it('does not alert "now" on the first observation of a new subscriber', async () => {
    const env = await makeEnv();
    const r = await makeReceiver();
    await putSubscriber(env.SUBS, subscriber(r, [A]));
    const m = mockFetch([r]);
    await runCron(env, NOW, m.fetch);
    expect(m.pushes).toHaveLength(0);
    const id = await endpointId(r.sub.endpoint);
    expect(JSON.parse(env.SUBS.map.get('state:' + id)!).ratings).toEqual({ a: 'good' });
  });

  it('skips subscribers in quiet hours without touching state', async () => {
    const env = await makeEnv({ QUIET_HOURS: '20-6' });
    const r = await makeReceiver();
    const id = await putSubscriber(env.SUBS, subscriber(r, [A], 'Asia/Tokyo')); // 21:10 local
    const m = mockFetch([r]);
    const report = await runCron(env, NOW, m.fetch);
    expect(report).toMatchObject({ subscribers: 1, skippedQuiet: 1 });
    expect(m.weatherCalls).toHaveLength(0);
    expect(env.SUBS.map.has('state:' + id)).toBe(false);
  });

  it('caps pushes per run with MAX_PUSHES', async () => {
    const env = await makeEnv({ MAX_PUSHES: '1' });
    const r = await makeReceiver();
    const id = await putSubscriber(env.SUBS, subscriber(r, [A, B]));
    await putState(env.SUBS, id, { ratings: { a: 'light' }, notifiedWindows: {} });
    const m = mockFetch([r]);
    const report = await runCron(env, NOW, m.fetch);
    expect(m.pushes).toHaveLength(1);
    expect(JSON.parse(m.pushes[0].payload).tag).toBe('now-a');
    expect(report).toMatchObject({ alerts: 2, sent: 1 });
    // The cap cut delivery short: the delivered "now" transition is kept, the forecast window is not consumed.
    const st = JSON.parse(env.SUBS.map.get('state:' + id)!) as AlertState;
    expect(st.ratings.a).toBe('good');
    expect(st.notifiedWindows).toEqual({});

    // Run 2: "now" does not repeat; the pending forecast alert goes out instead.
    const m2 = mockFetch([r]);
    const report2 = await runCron(env, NOW + 30 * 60_000, m2.fetch);
    expect(m2.pushes.map((p) => JSON.parse(p.payload).tag)).toEqual(['fc-b@2025-06-01T15:00/2025-06-01T18:00']);
    expect(report2).toMatchObject({ alerts: 1, sent: 1 });
    const st2 = JSON.parse(env.SUBS.map.get('state:' + id)!) as AlertState;
    expect(Object.keys(st2.notifiedWindows)).toEqual(['b@2025-06-01T15:00/2025-06-01T18:00']);

    // Run 3: nothing left to send.
    const m3 = mockFetch([r]);
    await runCron(env, NOW + 60 * 60_000, m3.fetch);
    expect(m3.pushes).toHaveLength(0);
  });

  it('does not consume alerts when a push fails, and resends next run', async () => {
    const env = await makeEnv();
    const r = await makeReceiver();
    const id = await putSubscriber(env.SUBS, subscriber(r, [A]));
    await putState(env.SUBS, id, { ratings: { a: 'light' }, notifiedWindows: {} });
    const failing = mockFetch([r], { [r.sub.endpoint]: 500 });
    const report = await runCron(env, NOW, failing.fetch);
    expect(report).toMatchObject({ alerts: 1, sent: 0, failed: 1 });
    expect((JSON.parse(env.SUBS.map.get('state:' + id)!) as AlertState).ratings.a).toBe('light');
    const ok = mockFetch([r]);
    const report2 = await runCron(env, NOW + 30 * 60_000, ok.fetch);
    expect(report2).toMatchObject({ alerts: 1, sent: 1 });
    expect((JSON.parse(env.SUBS.map.get('state:' + id)!) as AlertState).ratings.a).toBe('good');
  });

  it('survives an Open-Meteo outage without changing state', async () => {
    const env = await makeEnv();
    const r = await makeReceiver();
    const id = await putSubscriber(env.SUBS, subscriber(r, [A]));
    const failing = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    const report = await runCron(env, NOW, failing);
    expect(report).toMatchObject({ subscribers: 1, alerts: 0, sent: 0 });
    expect(env.SUBS.map.has('state:' + id)).toBe(false);
  });

  it('is wired to the scheduled handler', async () => {
    const env = await makeEnv();
    const pending: Promise<unknown>[] = [];
    worker.scheduled({ scheduledTime: NOW }, env, { waitUntil: (p) => pending.push(p) });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
  });
});
