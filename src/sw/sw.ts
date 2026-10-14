/// <reference lib="webworker" />
import { notificationOptions, runCheck } from '../lib/check';
import { FETCHED_HEADER, isTileFresh } from '../lib/tilecache';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `gust-${__SW_VERSION__}`;
const DATA_CACHE = 'gust-data';
/** Runtime cache for OpenStreetMap tiles (never precached), capped to TILE_MAX entries. */
const TILE_CACHE = 'gust-tiles';
const TILE_MAX = 200;
const ICONS = ['icon-192.png', 'icon-512.png', 'badge-96.png', 'apple-touch-icon.png', 'icon.svg'].map((f) => __BASE__ + 'icons/' + f);
const SHELL = [__BASE__, __BASE__ + 'app/', __BASE__ + 'manifest.webmanifest', ...ICONS, ...__PRECACHE__.filter((f) => !f.endsWith('.html'))];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE && k !== DATA_CACHE && k !== TILE_CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(req: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    throw e;
  }
}

/**
 * OSM tiles: cache-first while fresh (Cache-Control max-age / Expires, else 7 days; see
 * lib/tilecache.ts). Stale tiles are revalidated from the network, and the stale copy is served
 * when offline or on error. Eviction is FIFO by (re)fetch time: fresh hits are not re-put (that
 * would copy the body on every hit), refetches move the tile to the end. Capped at TILE_MAX.
 */
async function tileCacheFirst(event: FetchEvent): Promise<Response> {
  const req = event.request;
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit && isTileFresh(hit.headers, Date.now())) return hit;
  let res: Response;
  try {
    res = await fetch(req);
  } catch (e) {
    if (hit) return hit;
    throw e;
  }
  if (!res.ok) return hit ?? res;
  const headers = new Headers(res.headers);
  headers.set(FETCHED_HEADER, String(Date.now()));
  // The blob below is the decoded body: drop headers that describe the wire encoding.
  headers.delete('content-encoding');
  headers.delete('content-length');
  const copy = new Response(await res.clone().blob(), { status: res.status, statusText: res.statusText, headers });
  event.waitUntil(
    (async () => {
      await cache.delete(req);
      await cache.put(req, copy);
      const keys = await cache.keys();
      for (const k of keys.slice(0, Math.max(0, keys.length - TILE_MAX))) await cache.delete(k);
    })(),
  );
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'api.open-meteo.com' || url.hostname === 'marine-api.open-meteo.com' || url.hostname.includes('overpass')) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(tileCacheFirst(event));
    return;
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(__BASE__)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await networkFirst(req, CACHE);
        } catch {
          const path = url.pathname.startsWith(__BASE__ + 'app') ? __BASE__ + 'app/' : __BASE__;
          return (await caches.match(path)) ?? Response.error();
        }
      })(),
    );
    return;
  }
  // Hashed assets: cache first.
  event.respondWith(
    (async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && url.pathname.startsWith(__BASE__ + 'assets/')) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })(),
  );
});

async function backgroundCheck(): Promise<void> {
  const { alerts } = await runCheck();
  for (const a of alerts) await self.registration.showNotification(a.title, notificationOptions(a));
}

// Android / Chromium: Periodic Background Sync.
self.addEventListener('periodicsync', ((event: Event & { tag: string; waitUntil(p: Promise<unknown>): void }) => {
  if (event.tag === 'gust-check') event.waitUntil(backgroundCheck());
}) as EventListener);

// Web Push from the optional backend. Payload may be a ready notification or a "check" ping.
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let data: { title?: string; body?: string; tag?: string; url?: string; type?: string };
      try {
        data = event.data?.json() ?? {};
      } catch {
        data = { title: 'gust', body: event.data?.text() };
      }
      if (data.title) {
        await self.registration.showNotification(data.title, {
          body: data.body,
          tag: data.tag,
          icon: __BASE__ + 'icons/icon-192.png',
          data: { url: data.url ?? __BASE__ + 'app/' },
        });
        return;
      }
      const { alerts } = await runCheck();
      // iOS requires every push to show a notification.
      if (alerts.length === 0) await self.registration.showNotification('gust', { body: 'Wind checked — nothing new.', tag: 'gust-check' });
      for (const a of alerts) await self.registration.showNotification(a.title, notificationOptions(a));
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'check') event.waitUntil(backgroundCheck());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? __BASE__ + 'app/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if (c.url.includes(__BASE__ + 'app')) {
          await (c as WindowClient).focus();
          (c as WindowClient).navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
