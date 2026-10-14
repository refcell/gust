import type { LatLon } from './geo';
import type { Settings, Spot } from './types';

/**
 * Pure helpers for keeping the push backend's copy of the settings and watched spots in sync.
 * No I/O here: `background.ts` does the fetch, these decide what to send and in which order.
 */

export interface SubscribeBody {
  subscription: unknown;
  settings: Settings;
  location: LatLon | null;
  spots: { id: string; name: string; lat: number; lon: number; sectors: NonNullable<Spot['sectors']> }[];
  tz: string;
}

/** Body for `POST /subscribe`. Muted spots are left out so the backend never alerts for them. */
export function subscribeBody(o: { subscription: unknown; settings: Settings; watched: readonly Spot[]; loc: LatLon | null; tz: string }): SubscribeBody {
  const muted = new Set(o.settings.muted ?? []);
  return {
    subscription: o.subscription,
    settings: o.settings,
    location: o.loc,
    spots: o.watched.filter((s) => !muted.has(s.id)).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, sectors: s.sectors ?? [] })),
    tz: o.tz,
  };
}

/** Stable key for "settings or watched spots changed" (effect dependency / dedupe). */
export function syncKey(settings: Settings, watched: readonly Spot[]): string {
  return JSON.stringify([settings, watched.map((s) => s.id)]);
}

export interface SyncResult {
  ok: boolean;
  /** A newer value was queued before this one finished (or ran): ignore this result. */
  stale: boolean;
}

/**
 * Latest-wins sender: requests run one at a time, in order, so an older body can never reach the
 * server after a newer one. A queued value is skipped (not sent) when a newer one arrives before
 * its turn, and every result says whether it is stale.
 */
export function createLatestSender<T>(send: (value: T) => Promise<boolean>): (value: T) => Promise<SyncResult> {
  let seq = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return (value) => {
    const my = ++seq;
    const run = chain.then(async (): Promise<SyncResult> => {
      if (my !== seq) return { ok: false, stale: true };
      let ok: boolean;
      try {
        ok = await send(value);
      } catch {
        ok = false;
      }
      return { ok, stale: my !== seq };
    });
    chain = run;
    return run;
  };
}
