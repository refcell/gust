import type { LatLon } from '../lib/geo';
import { K } from '../lib/check';
import { kvSet } from '../lib/kv';
import type { Settings, Spot } from '../lib/types';

export const PUSH_API = import.meta.env.VITE_PUSH_API?.replace(/\/$/, '') ?? '';
export const VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';
export const pushConfigured = Boolean(PUSH_API && VAPID_KEY);

export interface BackgroundStatus {
  periodicSync: 'registered' | 'unsupported' | 'denied';
  push: 'subscribed' | 'unconfigured' | 'unsupported' | 'failed';
}

interface PeriodicSyncManager {
  register(tag: string, opts: { minInterval: number }): Promise<void>;
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Enable whatever background path this platform supports:
 * Periodic Background Sync (Chromium, installed) and/or Web Push (when the build has a push server).
 * `prompt: false` only reports/refreshes existing registrations.
 */
export async function enableBackground(o: { settings: Settings; watched: Spot[]; loc: LatLon | null; prompt: boolean }): Promise<BackgroundStatus> {
  await kvSet(K.settings, o.settings);
  await kvSet(K.watch, o.watched);
  const status: BackgroundStatus = { periodicSync: 'unsupported', push: pushConfigured ? 'unsupported' : 'unconfigured' };
  const reg = await navigator.serviceWorker?.ready.catch(() => undefined);
  if (!reg) return status;

  const ps = (reg as ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }).periodicSync;
  if (ps) {
    try {
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName });
      if (st.state === 'granted') {
        await ps.register('gust-check', { minInterval: 60 * 60_000 });
        status.periodicSync = 'registered';
      } else status.periodicSync = 'denied';
    } catch {
      status.periodicSync = 'denied';
    }
  }

  if (pushConfigured && 'PushManager' in window) {
    try {
      let sub = await reg.pushManager.getSubscription();
      if (!sub && o.prompt) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_KEY) });
      if (sub) {
        const res = await fetch(`${PUSH_API}/subscribe`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            subscription: sub.toJSON(),
            settings: o.settings,
            location: o.loc,
            spots: o.watched.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, sectors: s.sectors ?? [] })),
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        status.push = res.ok ? 'subscribed' : 'failed';
      }
    } catch {
      status.push = 'failed';
    }
  }
  return status;
}

/** Ask for notification permission (must run from a user gesture), then enable background paths. */
export async function requestAlerts(o: { settings: Settings; watched: Spot[]; loc: LatLon | null }): Promise<{ perm: NotificationPermission; status: BackgroundStatus | null }> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { perm, status: null };
  return { perm, status: await enableBackground({ ...o, prompt: true }) };
}

/** Show a notification through the service worker when possible (required on Android and iOS). */
export async function showLocalNotification(title: string, options: NotificationOptions): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration(__BASE__);
  if (reg) await reg.showNotification(title, options);
  else new Notification(title, options);
}
