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
 * Background-safe check: fetch wind for the watched spots, compute alerts, persist state.
 * Used by the service worker (periodic sync / push) and by the page.
 */
export async function runCheck(opts: { spots?: Spot[]; settings?: Settings; alertOnFirst?: boolean } = {}): Promise<CheckResult> {
  const settings = opts.settings ?? (await kvGet<Settings>(K.settings)) ?? DEFAULT_SETTINGS;
  const spots = opts.spots ?? (await kvGet<Spot[]>(K.watch)) ?? [];
  if (spots.length === 0) return { alerts: [], wind: {} };
  const winds = await fetchWind(spots);
  const entries: { spot: Spot; wind: SpotWind }[] = [];
  const wind: Record<string, SpotWind> = {};
  spots.forEach((spot, i) => {
    const w = winds[i];
    if (w) {
      entries.push({ spot, wind: w });
      wind[spot.id] = w;
    }
  });
  const prev = (await kvGet<AlertState>(K.alertState)) ?? EMPTY_ALERT_STATE;
  const { alerts, next } = computeAlerts(entries, prev, settings, { alertOnFirst: opts.alertOnFirst });
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
