import { distanceKm, type LatLon } from './geo';
import { MAX_PUSH_SPOTS } from './limits';
import type { Settings, Spot } from './types';

/**
 * Pure helpers for keeping the background copies (IndexedDB for the service worker, push backend)
 * of the settings and watched spots in sync. No I/O here: `background.ts` does the writes and the
 * fetch, these decide what to send and in which order.
 */

export interface SubscribeBody {
  subscription: unknown;
  settings: Settings;
  location: LatLon | null;
  spots: { id: string; name: string; lat: number; lon: number; sectors: NonNullable<Spot['sectors']> }[];
  tz: string;
}

/**
 * Spots the push backend should watch: muted spots left out, then at most `max` (the server's
 * limit), favourites first (nearest first), then the nearest others. Distance is to the nearest
 * origin (last location, saved places); without origins the input order is kept.
 */
export function pushSpots(watched: readonly Spot[], settings: Settings, origins: readonly LatLon[], max = MAX_PUSH_SPOTS): { spots: Spot[]; total: number } {
  const muted = new Set(settings.muted ?? []);
  const fav = new Set(settings.favorites ?? []);
  const live = watched.filter((s) => !muted.has(s.id));
  const dist = (s: Spot) => (origins.length ? Math.min(...origins.map((o) => distanceKm(o, s))) : 0);
  const ranked = live
    .map((spot, i) => ({ spot, i, fav: fav.has(spot.id), d: dist(spot) }))
    .sort((a, b) => Number(b.fav) - Number(a.fav) || a.d - b.d || a.i - b.i)
    .slice(0, max)
    .map((x) => x.spot);
  return { spots: ranked, total: live.length };
}

/** Body for `POST /subscribe`: muted spots left out, capped at the server limit (see `pushSpots`). */
export function subscribeBody(o: { subscription: unknown; settings: Settings; watched: readonly Spot[]; loc: LatLon | null; origins?: readonly LatLon[]; tz: string }): SubscribeBody {
  const origins = o.origins ?? (o.loc ? [o.loc] : []);
  return {
    subscription: o.subscription,
    settings: o.settings,
    location: o.loc,
    spots: pushSpots(o.watched, o.settings, origins).spots.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, sectors: s.sectors ?? [] })),
    tz: o.tz,
  };
}

/** Stable key for "settings or watched spots changed" (effect dependency / dedupe). */
export function syncKey(settings: Settings, watched: readonly Spot[]): string {
  return JSON.stringify([settings, watched.map((s) => s.id)]);
}

export interface SyncResult {
  ok: boolean;
  /** A newer revision exists (queued, sent, or seen): ignore this result. */
  stale: boolean;
}

/**
 * Revision-ordered sender. Each value carries a revision (higher = newer state, see
 * `nextRevision`). Requests run one at a time; a value is dropped without being sent when a
 * newer revision has already been seen — whether it arrived earlier or later — so an older
 * snapshot can never overwrite a newer one, regardless of the order callers finish their work.
 */
export function createRevisionedSender<T>(send: (value: T) => Promise<boolean>): (rev: number, value: T) => Promise<SyncResult> {
  let newest = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return (rev, value) => {
    if (rev < newest) return Promise.resolve({ ok: false, stale: true });
    newest = rev;
    const run = chain.then(async (): Promise<SyncResult> => {
      if (rev !== newest) return { ok: false, stale: true };
      let ok: boolean;
      try {
        ok = await send(value);
      } catch {
        ok = false;
      }
      return { ok, stale: rev !== newest };
    });
    chain = run;
    return run;
  };
}

/** Latest-wins sender: like `createRevisionedSender`, with call order as the revision. */
export function createLatestSender<T>(send: (value: T) => Promise<boolean>): (value: T) => Promise<SyncResult> {
  const s = createRevisionedSender(send);
  let seq = 0;
  return (value) => s(++seq, value);
}

let revision = 0;
/**
 * Next sync revision. Take it synchronously when the settings / watched spots are read (render or
 * effect time), before any await, so revision order matches state order.
 */
export function nextRevision(): number {
  return ++revision;
}
