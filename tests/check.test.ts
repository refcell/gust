import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert, AlertState } from '../src/lib/alerts';
import { DEFAULT_SETTINGS, type Spot, type SpotWind } from '../src/lib/types';

// In-memory stand-in for the IndexedDB store; no network (every sample is passed as `cached`).
const store = new Map<string, unknown>();
vi.mock('../src/lib/kv', () => ({
  kvGet: async (k: string) => structuredClone(store.get(k)),
  kvSet: async (k: string, v: unknown) => {
    store.set(k, structuredClone(v));
  },
}));
vi.mock('../src/lib/openmeteo', () => ({
  fetchSpotWind: async (spots: unknown[]) => {
    if (spots.length) throw new Error('no network in tests');
    return { wind: {}, failedIds: [] };
  },
}));

const { runCheck, notificationOptions, K } = await import('../src/lib/check');

const NOW = Date.parse('2025-06-01T12:10:00Z');
const A: Spot = { id: 'a', name: 'Spot A', lat: 10, lon: 20, sectors: [[225, 300]] } as Spot;

/** On now (20 kn W), with a separate good window 15:00-18:00 (light in between). */
function windA(): SpotWind {
  const hourly = [];
  for (let i = 0; i < 48; i++) {
    const good = i === 12 || (i >= 15 && i <= 18);
    hourly.push({ time: new Date(Date.parse('2025-06-01T00:00Z') + i * 3600_000).toISOString().slice(0, 16), speedKn: good ? 20 : 5, gustKn: good ? 25 : 8, dirDeg: 270 });
  }
  return { current: { time: '2025-06-01T12:00', speedKn: 20, gustKn: 25, dirDeg: 270 }, hourly, utcOffsetSeconds: 0, fetchedAt: NOW, observedAt: NOW - 10 * 60_000 } as SpotWind;
}

const PREV: AlertState = { ratings: { a: 'light' }, notifiedWindows: {} };
const state = () => store.get(K.alertState) as AlertState;
const wind = () => ({ a: windA() });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  store.clear();
  store.set(K.alertState, PREV);
});
afterEach(() => vi.useRealTimers());

describe('runCheck delivery (foreground caller)', () => {
  it('commits alert state only once alerts are delivered', async () => {
    const shown: string[] = [];
    const r = await runCheck({ spots: [A], settings: DEFAULT_SETTINGS, cached: wind(), deliver: async (a) => void shown.push(a.kind) });
    expect(shown).toEqual(['now', 'forecast']);
    expect(r.alerts.map((a) => a.kind)).toEqual(['now', 'forecast']);
    expect(state().ratings.a).toBe('good');
    expect(Object.keys(state().notifiedWindows)).toEqual(['a@2025-06-01T15:00/2025-06-01T18:00']);
  });

  it('a rejecting notifier rolls back every alert, and the next check retries them', async () => {
    const fail = vi.fn(async () => {
      throw new Error('showNotification failed');
    });
    const r = await runCheck({ spots: [A], settings: DEFAULT_SETTINGS, cached: wind(), deliver: fail });
    expect(fail).toHaveBeenCalledTimes(2);
    expect(r.alerts).toEqual([]);
    expect(state()).toEqual(PREV);
    // Wind data is still returned and cached even though no alert was shown.
    expect(r.wind.a).toBeDefined();

    const ok: Alert[] = [];
    const again = await runCheck({ spots: [A], settings: DEFAULT_SETTINGS, cached: wind(), deliver: async (a) => void ok.push(a) });
    expect(again.alerts.map((a) => a.kind)).toEqual(['now', 'forecast']);
    expect(state().ratings.a).toBe('good');
  });

  it('a notifier resolving false counts as undelivered; a first observation is dropped, not reverted', async () => {
    store.set(K.alertState, { ratings: {}, notifiedWindows: {} });
    await runCheck({ spots: [A], settings: DEFAULT_SETTINGS, cached: wind(), alertOnFirst: true, deliver: async () => false });
    expect(state()).toEqual({ ratings: {}, notifiedWindows: {} });
  });

  it('without a notifier: no alerts, ratings advance, forecast windows stay unnotified', async () => {
    const r = await runCheck({ spots: [A], settings: DEFAULT_SETTINGS, cached: wind() });
    expect(r.alerts).toEqual([]);
    expect(state()).toEqual({ ratings: { a: 'good' }, notifiedWindows: {} });
  });
});

describe('runCheck delivery (service-worker caller)', () => {
  it('reads settings and spots from storage and rolls back only the failed alert', async () => {
    store.set(K.settings, DEFAULT_SETTINGS);
    store.set(K.watch, [A]);
    store.set(K.lastWind, wind());
    const registration = {
      showNotification: vi.fn(async (_title: string, opts: NotificationOptions) => {
        if (opts.tag?.startsWith('fc-')) throw new TypeError('No notification permission');
      }),
    };
    const r = await runCheck({ cached: wind(), deliver: (a) => registration.showNotification(a.title, notificationOptions(a)) });
    expect(registration.showNotification).toHaveBeenCalledTimes(2);
    expect(r.alerts.map((a) => a.kind)).toEqual(['now']);
    // The "now" alert was shown and is committed; the forecast window retries next check.
    expect(state()).toEqual({ ratings: { a: 'good' }, notifiedWindows: {} });

    const retry = await runCheck({ cached: wind(), deliver: (a) => registration.showNotification(a.title, notificationOptions(a)).then(() => true) });
    expect(retry.alerts).toEqual([]); // still failing
    registration.showNotification.mockImplementation(async () => undefined);
    const ok = await runCheck({ cached: wind(), deliver: (a) => registration.showNotification(a.title, notificationOptions(a)) });
    expect(ok.alerts.map((a) => a.kind)).toEqual(['forecast']);
    expect(Object.keys(state().notifiedWindows)).toHaveLength(1);
  });
});

describe('checkPush (service worker "check" push)', () => {
  const alert: Alert = { tag: 'now-a', title: 'A is on', body: '', spotId: 'a', kind: 'now' };
  it('shows a fallback when the check throws, and when nothing was delivered', async () => {
    const { checkPush } = await import('../src/lib/check');
    const shown: string[] = [];
    const fallback = async (b: string) => void shown.push(b);
    await checkPush(async () => {
      throw new Error('idb');
    }, async () => true, fallback);
    expect(shown).toEqual(['Could not check the wind. Open gust to refresh.']);
    shown.length = 0;
    await checkPush(async () => ({ alerts: [] }), async () => true, fallback);
    expect(shown).toEqual(['Wind checked — nothing new.']);
    shown.length = 0;
    await checkPush(async (deliver) => {
      await deliver(alert).catch(() => false);
      return { alerts: [] };
    }, async () => {
      throw new Error('denied');
    }, fallback);
    expect(shown).toHaveLength(1);
  });
  it('shows no fallback once an alert was delivered', async () => {
    const { checkPush } = await import('../src/lib/check');
    const shown: string[] = [];
    await checkPush(async (deliver) => {
      await deliver(alert);
      return { alerts: [alert] };
    }, async () => true, async (b) => void shown.push(b));
    expect(shown).toEqual([]);
  });
});
