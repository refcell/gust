import { computeAlerts, EMPTY_ALERT_STATE, type Alert } from '../../src/lib/alerts';
import { fetchWind } from '../../src/lib/openmeteo';
import type { Spot, SpotWind } from '../../src/lib/types';
import type { Env } from './env';
import { deleteSubscriber, getState, getSubscriber, listSubscriberIds, putState } from './store';
import type { Subscriber } from './validate';
import { sendPush, type VapidKeys } from './webpush';

export const DEFAULT_APP_URL = 'https://refcell.github.io/gust/app/';
export const DEFAULT_QUIET = '22-6';

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export interface CronReport {
  subscribers: number;
  skippedQuiet: number;
  alerts: number;
  sent: number;
  failed: number;
  removed: number;
}

export function vapidFromEnv(env: Env): VapidKeys {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

/** Hour (0-23) in a time zone. */
export function localHour(now: number, tz: string): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now);
    return Number(h) % 24;
  } catch {
    return new Date(now).getUTCHours();
  }
}

/** True when `hour` falls in a "start-end" range (may wrap midnight, end exclusive). */
export function inQuietHours(hour: number, spec: string): boolean {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(spec);
  if (!m) return false;
  const a = Number(m[1]) % 24;
  const b = Number(m[2]) % 24;
  if (a === b) return false;
  return a < b ? hour >= a && hour < b : hour >= a || hour < b;
}

export function alertPayload(a: Alert, appUrl: string): PushPayload {
  const u = new URL(appUrl);
  u.searchParams.set('spot', a.spotId);
  return { title: a.title, body: a.body, tag: a.tag, url: u.toString() };
}

/** Individual notifications per subscriber per run; the rest are folded into one summary. */
export const MAX_PER_SUBSCRIBER = 3;

/** Ready-to-display payloads for one subscriber: "now" alerts first, overflow folded into a summary. */
export function buildPayloads(alerts: Alert[], appUrl: string): { payload: PushPayload; urgent: boolean }[] {
  const sorted = [...alerts.filter((a) => a.kind === 'now'), ...alerts.filter((a) => a.kind !== 'now')];
  const fits = sorted.length <= MAX_PER_SUBSCRIBER;
  const single = fits ? sorted : sorted.slice(0, MAX_PER_SUBSCRIBER - 1);
  const out = single.map((a) => ({ payload: alertPayload(a, appUrl), urgent: a.kind === 'now' }));
  if (!fits) {
    const rest = sorted.slice(MAX_PER_SUBSCRIBER - 1);
    const names = [...new Set(rest.map((a) => a.title.replace(/^Good window ahead: /, '').replace(/ is on$/, '')))];
    out.push({
      payload: { title: `Wind at ${names.length} more spot${names.length === 1 ? '' : 's'}`, body: names.join(', '), tag: 'gust-summary', url: appUrl },
      urgent: rest.some((a) => a.kind === 'now'),
    });
  }
  return out;
}

const pointKey = (s: { lat: number; lon: number }) => `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;

/**
 * Cron entry: fetch wind for every subscriber's spots (deduplicated, batched by Open-Meteo),
 * score with the shared client logic, push new alerts, and persist per-subscriber AlertState.
 */
export async function runCron(env: Env, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<CronReport> {
  const report: CronReport = { subscribers: 0, skippedQuiet: 0, alerts: 0, sent: 0, failed: 0, removed: 0 };
  const quiet = env.QUIET_HOURS ?? DEFAULT_QUIET;
  const appUrl = env.APP_URL || DEFAULT_APP_URL;
  const maxPushes = Number(env.MAX_PUSHES) > 0 ? Number(env.MAX_PUSHES) : Infinity;
  const vapid = vapidFromEnv(env);

  const active: { id: string; sub: Subscriber }[] = [];
  for (const id of await listSubscriberIds(env.SUBS)) {
    const sub = await getSubscriber(env.SUBS, id);
    if (!sub) continue;
    report.subscribers++;
    // Skip entirely during quiet hours so state is unchanged and transitions alert afterwards.
    if (quiet && inQuietHours(localHour(now, sub.tz), quiet)) {
      report.skippedQuiet++;
      continue;
    }
    if (sub.spots.length > 0) active.push({ id, sub });
  }
  if (active.length === 0) return report;

  const points = new Map<string, { lat: number; lon: number }>();
  for (const { sub } of active) for (const s of sub.spots) points.set(pointKey(s), { lat: s.lat, lon: s.lon });
  const keys = [...points.keys()];
  const winds = await fetchWind([...points.values()], fetchImpl);
  const windByPoint = new Map<string, SpotWind>();
  keys.forEach((k, i) => {
    const w = winds[i];
    if (w) windByPoint.set(k, w);
  });

  for (const { id, sub } of active) {
    const entries: { spot: Spot; wind: SpotWind }[] = [];
    for (const s of sub.spots) {
      const wind = windByPoint.get(pointKey(s));
      if (wind) entries.push({ spot: s, wind });
    }
    if (entries.length === 0) continue;
    const stored = await getState(env.SUBS, id);
    const prev = stored ?? EMPTY_ALERT_STATE;
    const { alerts, next } = computeAlerts(entries, prev, sub.settings, { now });
    report.alerts += alerts.length;

    let gone = false;
    for (const { payload, urgent } of buildPayloads(alerts, appUrl)) {
      if (report.sent + report.failed >= maxPushes) break;
      try {
        const res = await sendPush(sub.subscription, JSON.stringify(payload), vapid, {
          ttl: urgent ? 3 * 3600 : 12 * 3600,
          urgency: urgent ? 'high' : 'normal',
          fetchImpl,
        });
        if (res.status === 404 || res.status === 410) {
          gone = true;
          break;
        }
        if (res.ok) report.sent++;
        else report.failed++;
      } catch {
        report.failed++;
      }
    }
    if (gone) {
      await deleteSubscriber(env.SUBS, id);
      report.removed++;
      continue;
    }
    // KV writes are metered (1000/day on the free plan): only write when something changed.
    if (!stored || JSON.stringify(next) !== JSON.stringify(stored)) await putState(env.SUBS, id, next);
  }
  return report;
}
