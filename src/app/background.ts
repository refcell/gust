import type { LatLon } from '../lib/geo';
import { K } from '../lib/check';
import { kvSet } from '../lib/kv';
import type { Settings, Spot } from '../lib/types';
import { createRevisionedSender, nextRevision, subscribeBody, type SubscribeBody, type SyncResult } from '../lib/pushsync';

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
 * One sync intent: the settings / watched spots at revision `rev` (from `nextRevision`, taken when
 * the state was read). Older revisions are dropped before they are persisted or posted.
 */
export interface SyncIntent {
  rev: number;
  settings: Settings;
  watched: Spot[];
  loc: LatLon | null;
  /** Last location and saved places, used to pick which spots the push server watches. */
  origins: LatLon[];
}

/** IndexedDB copy for the service worker (periodic sync / push checks), revision-ordered. */
const persist = createRevisionedSender(async (i: SyncIntent) => {
  await kvSet(K.settings, i.settings);
  await kvSet(K.watch, i.watched);
  return true;
});

/** Every `/subscribe` POST goes through this, so an older revision never overwrites newer settings. */
const postSubscribe = createRevisionedSender(async (body: SubscribeBody) => {
  const res = await fetch(`${PUSH_API}/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.ok;
});

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const bodyFor = (sub: PushSubscription, i: SyncIntent) =>
  subscribeBody({ subscription: sub.toJSON(), settings: i.settings, watched: i.watched, loc: i.loc, origins: i.origins, tz: tz() });

/** Save settings / watched spots for the service worker. Dropped if a newer revision was saved. */
export function persistBackground(i: SyncIntent): Promise<SyncResult> {
  return persist(i.rev, i);
}

/**
 * Push the settings / watched spots (muted ones excluded, capped at the server limit) to the push
 * backend for an existing subscription. Independent of the wind fetch. No-op (null) when push is
 * not configured, unsupported, or there is no subscription yet.
 */
export async function syncPush(i: SyncIntent): Promise<SyncResult | null> {
  if (!pushConfigured || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker?.ready.catch(() => undefined);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return null;
    return await postSubscribe(i.rev, bodyFor(sub, i));
  } catch {
    return { ok: false, stale: false };
  }
}

/**
 * Enable whatever background path this platform supports:
 * Periodic Background Sync (Chromium, installed) and/or Web Push (when the build has a push server).
 * `prompt: false` only reports/refreshes existing registrations. Call with the current state: the
 * revision is taken synchronously here.
 */
export async function enableBackground(o: Omit<SyncIntent, 'rev'> & { prompt: boolean }): Promise<BackgroundStatus> {
  const intent: SyncIntent = { ...o, rev: nextRevision() };
  await persistBackground(intent);
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
        const r = await postSubscribe(intent.rev, bodyFor(sub, intent));
        status.push = r.ok || r.stale ? 'subscribed' : 'failed';
      }
    } catch {
      status.push = 'failed';
    }
  }
  return status;
}

/** Ask for notification permission (must run from a user gesture), then enable background paths. */
export async function requestAlerts(o: Omit<SyncIntent, 'rev'>): Promise<{ perm: NotificationPermission; status: BackgroundStatus | null }> {
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
