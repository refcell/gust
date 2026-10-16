import { computeAlerts, EMPTY_ALERT_STATE, rollback, type Alert, type AlertState } from './alerts';
import { kvGet, kvSet } from './kv';
import { fetchSpotWind } from './openmeteo';
import { DEFAULT_SETTINGS, type Settings, type Spot, type SpotWind } from './types';

/** Keys persisted in IndexedDB so the service worker can run checks in the background. */
export const K = {
  settings: 'settings',
  watch: 'watchSpots',
  alertState: 'alertState',
  lastWind: 'lastWind',
  lastCheck: 'lastCheck',
} as const;

export interface CheckResult {
  /** Alerts that were delivered (shown); undelivered ones are rolled back and retry next check. */
  alerts: Alert[];
  wind: Record<string, SpotWind>;
  /** Spots whose wind request failed: skipped this check (no alert, state unchanged); retry them. */
  failedIds: string[];
}

/**
 * Shows one alert. Resolves true (or void) when it was shown; false or a rejection means it was not
 * delivered, and its state change is rolled back so it alerts again on the next check.
 */
export type Deliver = (a: Alert) => Promise<boolean | void>;

/**
 * Background-safe check: fetch wind for the watched spots (minus `cached` ones), compute alerts,
 * deliver them through `deliver`, then persist state for the delivered ones only (like the push
 * server's rollback in server/src/cron.ts). Without `deliver` (notifications cannot be shown) no
 * alerts are returned and forecast windows are not marked notified, so they still alert once the
 * user enables notifications.
 * Used by the service worker (periodic sync / push) and by the page.
 */
export async function runCheck(opts: { spots?: Spot[]; settings?: Settings; alertOnFirst?: boolean; deliver?: Deliver; cached?: Record<string, SpotWind> } = {}): Promise<CheckResult> {
  const settings = opts.settings ?? (await kvGet<Settings>(K.settings)) ?? DEFAULT_SETTINGS;
  const spots = opts.spots ?? (await kvGet<Spot[]>(K.watch)) ?? [];
  if (spots.length === 0) return { alerts: [], wind: {}, failedIds: [] };
  // Reuse samples the caller already has (fresh ones); fetch only the rest.
  const cached = opts.cached ?? {};
  const missing = spots.filter((s) => !cached[s.id]);
  // Failed spots are simply skipped: no entry, so no alert and their alert state is left alone.
  const { wind: fetched, failedIds } = await fetchSpotWind(missing);
  const entries: { spot: Spot; wind: SpotWind }[] = [];
  const wind: Record<string, SpotWind> = {};
  for (const spot of spots) {
    const w = cached[spot.id] ?? fetched[spot.id];
    if (w) {
      entries.push({ spot, wind: w });
      wind[spot.id] = w;
    }
  }
  const prev = (await kvGet<AlertState>(K.alertState)) ?? EMPTY_ALERT_STATE;
  const computed = computeAlerts(entries, prev, settings, { alertOnFirst: opts.alertOnFirst });
  const alerts: Alert[] = [];
  let next: AlertState;
  if (!opts.deliver) next = { ...computed.next, notifiedWindows: prev.notifiedWindows };
  else {
    const undelivered: Alert[] = [];
    for (const a of computed.alerts) {
      const ok = await opts.deliver(a).then(
        (r) => r !== false,
        () => false,
      );
      (ok ? alerts : undelivered).push(a);
    }
    next = undelivered.length ? rollback(prev, computed.next, undelivered) : computed.next;
  }
  await kvSet(K.alertState, next);
  const lastWind = { ...((await kvGet<Record<string, SpotWind>>(K.lastWind)) ?? {}), ...wind };
  await kvSet(K.lastWind, lastWind);
  await kvSet(K.lastCheck, Date.now());
  return { alerts, wind, failedIds };
}

export function notificationOptions(a: Alert): NotificationOptions {
  return {
    body: a.body,
    tag: a.tag,
    icon: __BASE__ + 'icons/icon-192.png',
    badge: __BASE__ + 'icons/badge-96.png',
    data: { url: __BASE__ + 'app/?spot=' + encodeURIComponent(a.spotId) },
  };
}

/**
 * Handle a "check" push in the service worker. iOS revokes push permission when a push shows no
 * notification, so whatever happens (no alerts, every alert failing, the check itself throwing)
 * at least one notification is shown.
 */
export async function checkPush(
  run: (deliver: Deliver) => Promise<{ alerts: Alert[] }>,
  show: (a: Alert) => Promise<boolean | void>,
  fallback: (body: string) => Promise<void>,
): Promise<void> {
  let delivered = 0;
  const deliver: Deliver = async (a) => {
    const ok = (await show(a)) !== false;
    if (ok) delivered += 1;
    return ok;
  };
  let failed = false;
  try {
    await run(deliver);
  } catch {
    failed = true;
  }
  if (delivered === 0) await fallback(failed ? 'Could not check the wind. Open gust to refresh.' : 'Wind checked — nothing new.');
}
