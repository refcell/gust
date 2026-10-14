import { computeAlerts, EMPTY_ALERT_STATE, type Alert, type AlertState } from './alerts';
import { kvGet, kvSet } from './kv';
import { fetchWind } from './openmeteo';
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
  alerts: Alert[];
  wind: Record<string, SpotWind>;
}

/**
 * Background-safe check: fetch wind for the watched spots (minus `cached` ones), compute alerts,
 * persist state.
 * Used by the service worker (periodic sync / push) and by the page.
 */
export async function runCheck(opts: { spots?: Spot[]; settings?: Settings; alertOnFirst?: boolean; deliver?: boolean; cached?: Record<string, SpotWind> } = {}): Promise<CheckResult> {
  const settings = opts.settings ?? (await kvGet<Settings>(K.settings)) ?? DEFAULT_SETTINGS;
  const spots = opts.spots ?? (await kvGet<Spot[]>(K.watch)) ?? [];
  if (spots.length === 0) return { alerts: [], wind: {} };
  // Reuse samples the caller already has (fresh ones); fetch only the rest.
  const cached = opts.cached ?? {};
  const missing = spots.filter((s) => !cached[s.id]);
  const winds = missing.length ? await fetchWind(missing) : [];
  const fetched = new Map<string, SpotWind>();
  missing.forEach((s, i) => {
    const w = winds[i];
    if (w) fetched.set(s.id, w);
  });
  const entries: { spot: Spot; wind: SpotWind }[] = [];
  const wind: Record<string, SpotWind> = {};
  for (const spot of spots) {
    const w = cached[spot.id] ?? fetched.get(spot.id);
    if (w) {
      entries.push({ spot, wind: w });
      wind[spot.id] = w;
    }
  }
  const prev = (await kvGet<AlertState>(K.alertState)) ?? EMPTY_ALERT_STATE;
  const computed = computeAlerts(entries, prev, settings, { alertOnFirst: opts.alertOnFirst });
  // When notifications cannot be shown, do not mark forecast windows as notified,
  // so they still alert once the user enables notifications.
  const deliver = opts.deliver ?? true;
  const next = deliver ? computed.next : { ...computed.next, notifiedWindows: prev.notifiedWindows };
  const alerts = deliver ? computed.alerts : [];
  await kvSet(K.alertState, next);
  const lastWind = { ...((await kvGet<Record<string, SpotWind>>(K.lastWind)) ?? {}), ...wind };
  await kvSet(K.lastWind, lastWind);
  await kvSet(K.lastCheck, Date.now());
  return { alerts, wind };
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
