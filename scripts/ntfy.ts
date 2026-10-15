/**
 * Logic for the no-account background alerts (`scripts/ntfy-alerts.ts`, run by
 * `.github/workflows/ntfy-alerts.yml`). No I/O beyond the injected `fetch`, so tests mock it.
 *
 * It reuses the push server's pieces (`server/src/cron.ts`): the same scoring and dedup
 * (`computeAlerts`, never alerting on a spot's first observation), quiet hours, at most 3
 * notifications per run with the rest folded into a summary, and per-alert rollback so a failed
 * publish is retried on the next run.
 */
import { computeAlerts, EMPTY_ALERT_STATE, type Alert, type AlertState } from '../src/lib/alerts';
import { configSettings, resolveWatchedSpots, type AlertsConfig } from '../src/lib/ntfy';
import { fetchWind } from '../src/lib/openmeteo';
import type { Spot, SpotWind } from '../src/lib/types';
import { buildPayloads, inQuietHours, localHour, rollback, type OutgoingPush } from '../server/src/cron';

export const DEFAULT_NTFY_SERVER = 'https://ntfy.sh';
export const STATE_VERSION = 1;

/** Persisted between runs (actions/cache). */
export interface NtfyState {
  version: number;
  alerts: AlertState;
  updatedAt: number;
}

/** State from a file's text; anything missing or malformed counts as a first run (null). */
export function parseState(text: string | null | undefined): NtfyState | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<NtfyState>;
    const a = v?.alerts;
    if (v?.version !== STATE_VERSION || !a || typeof a.ratings !== 'object' || typeof a.notifiedWindows !== 'object' || !a.ratings || !a.notifiedWindows) return null;
    return { version: STATE_VERSION, alerts: { ratings: { ...a.ratings }, notifiedWindows: { ...a.notifiedWindows } }, updatedAt: Number(v.updatedAt) || 0 };
  } catch {
    return null;
  }
}

/** RFC 2047 encoded-word for non-ASCII header values (ntfy decodes it; fetch rejects raw non-Latin-1). */
export function headerValue(s: string): string {
  const clean = s.replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const b64 = Buffer.from(clean, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

/** The ntfy publish request for one push: POST <server>/<topic>, message in the body. */
export function ntfyRequest(server: string, topic: string, push: OutgoingPush): { url: string; init: RequestInit } {
  const { payload } = push;
  const forecastOnly = push.alerts.length > 0 && push.alerts.every((a) => a.kind === 'forecast');
  return {
    url: `${server.replace(/\/+$/, '')}/${encodeURIComponent(topic)}`,
    init: {
      method: 'POST',
      headers: {
        Title: headerValue(payload.title),
        Tags: forecastOnly ? 'calendar' : 'wind_face',
        Click: payload.url,
        Priority: 'default',
      },
      body: payload.body,
    },
  };
}

export interface RunOptions {
  config: AlertsConfig;
  /** Previous state; null on the first run (or after the cache expired). */
  state: NtfyState | null;
  allSpots: readonly Spot[];
  topic: string;
  server?: string;
  now?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

export interface RunReport {
  quiet: boolean;
  watched: number;
  total: number;
  missingFavorites: string[];
  withWind: number;
  alerts: Alert[];
  sent: number;
  failed: number;
  /** State to persist (unchanged during quiet hours; undelivered alerts rolled back). */
  state: NtfyState | null;
}

export async function runNtfyAlerts(o: RunOptions): Promise<RunReport> {
  const now = o.now ?? Date.now();
  const fetchImpl = o.fetchImpl ?? fetch;
  const log = o.log ?? (() => undefined);
  const server = o.server || DEFAULT_NTFY_SERVER;
  const { spots, total, missingFavorites } = resolveWatchedSpots(o.allSpots, o.config);
  const report: RunReport = { quiet: false, watched: spots.length, total, missingFavorites, withWind: 0, alerts: [], sent: 0, failed: 0, state: o.state };

  // Like the push server: skip entirely during quiet hours, leaving state alone, so a spot that
  // turns good overnight alerts when quiet hours end.
  if (o.config.quietHours && inQuietHours(localHour(now, o.config.timezone), o.config.quietHours)) {
    report.quiet = true;
    return report;
  }
  if (spots.length === 0) return report;

  const winds = await fetchWind(spots, fetchImpl);
  const entries: { spot: Spot; wind: SpotWind }[] = [];
  spots.forEach((spot, i) => {
    const wind = winds[i];
    if (wind) entries.push({ spot, wind });
  });
  report.withWind = entries.length;
  if (entries.length === 0) return report;

  const prev = o.state?.alerts ?? EMPTY_ALERT_STATE;
  const { alerts, next } = computeAlerts(entries, prev, configSettings(o.config), { now });
  report.alerts = alerts;

  const delivered = new Set<Alert>();
  for (const push of buildPayloads(alerts, o.config.appUrl)) {
    const { url, init } = ntfyRequest(server, o.topic, push);
    try {
      const res = await fetchImpl(url, init);
      if (res.ok) {
        report.sent++;
        for (const a of push.alerts) delivered.add(a);
      } else {
        report.failed++;
        log(`ntfy responded ${res.status} for "${push.payload.title}"`);
      }
    } catch (e) {
      report.failed++;
      log(`ntfy request failed for "${push.payload.title}": ${(e as Error).message}`);
    }
  }
  // Undelivered alerts keep their previous rating / unnotified window, so they retry next run.
  const undelivered = alerts.filter((a) => !delivered.has(a));
  const persisted = undelivered.length === 0 ? next : rollback(prev, next, undelivered);
  report.state = { version: STATE_VERSION, alerts: persisted, updatedAt: now };
  return report;
}
