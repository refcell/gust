import { goodWindows, relativeDay } from './forecast';
import { scoreWind, type Rating } from './score';
import type { Settings, Spot, SpotWind } from './types';
import { formatSpeed } from './units';
import { compass } from './sectors';
import { isStale, localIsoToEpoch } from './time';

export interface AlertState {
  /** Last rating per spot id. */
  ratings: Record<string, Rating>;
  /** Forecast windows already notified, keyed `${spotId}@${start}/${end}` (older state: `${spotId}@${start}`). */
  notifiedWindows: Record<string, number>;
}

export const EMPTY_ALERT_STATE: AlertState = { ratings: {}, notifiedWindows: {} };

export interface Alert {
  tag: string;
  title: string;
  body: string;
  spotId: string;
  kind: 'now' | 'forecast';
}

/**
 * Whether a spot's sample may alert at all: not muted and not stale (e.g. offline-cached data).
 * Shared by computeAlerts and anything that lists spots as "on" for alerting purposes.
 */
export function alertEligible(spot: Pick<Spot, 'id'>, wind: { observedAt: number }, settings: Pick<Settings, 'muted'>, now = Date.now()): boolean {
  return !(settings.muted ?? []).includes(spot.id) && !isStale(wind, now);
}

/**
 * Watched spots scoring good now that would alert (same eligibility as computeAlerts: not muted,
 * not stale), e.g. for the enable-alerts confirmation.
 */
export function spotsOn(watched: Spot[], wind: Readonly<Record<string, SpotWind>>, settings: Settings, now = Date.now()): { spot: Spot; w: SpotWind }[] {
  const out: { spot: Spot; w: SpotWind }[] = [];
  for (const spot of watched) {
    const w = wind[spot.id];
    if (w && alertEligible(spot, w, settings, now) && scoreWind(w.current, spot.sectors, settings).rating === 'good') out.push({ spot, w });
  }
  return out;
}

/** For keys from older state (no end recorded): starts closer than this are the same session. */
export const SAME_START_MS = 3 * 3600_000;

/**
 * When a window for this spot that was already notified overlaps [startMs, endMs], return the time
 * it was notified (else 0). Forecast
 * updates shift window edges between checks; an overlapping window is the same session, while a
 * separate session later the same day (no overlap) still alerts.
 */
function nearNotified(notified: Record<string, number>, spotId: string, startMs: number, endMs: number, utcOffsetSeconds: number): number {
  const prefix = `${spotId}@`;
  for (const k of Object.keys(notified)) {
    if (!k.startsWith(prefix)) continue;
    const [s0, e0] = k.slice(prefix.length).split('/');
    const a = localIsoToEpoch(s0, utcOffsetSeconds);
    if (!Number.isFinite(a)) continue;
    if (e0) {
      const b = localIsoToEpoch(e0, utcOffsetSeconds);
      if (Number.isFinite(b) && startMs <= b && a <= endMs) return notified[k];
    } else if (Math.abs(a - startMs) < SAME_START_MS) return notified[k];
  }
  return 0;
}

/**
 * Compare fresh wind to the previous state and return the alerts to show plus the next state.
 * A "now" alert fires when a spot crosses into `good` (not on the first observation unless `alertOnFirst`).
 * A "forecast" alert fires once per future good window that starts within `horizonHours`.
 */
export function computeAlerts(
  entries: { spot: Spot; wind: SpotWind }[],
  prev: AlertState,
  settings: Settings,
  opts: { alertOnFirst?: boolean; horizonHours?: number; now?: number } = {},
): { alerts: Alert[]; next: AlertState } {
  const now = opts.now ?? Date.now();
  const horizon = (opts.horizonHours ?? 24) * 3600_000;
  const alerts: Alert[] = [];
  const ratings: Record<string, Rating> = { ...prev.ratings };
  const notified: Record<string, number> = {};
  // Forget windows notified more than three days ago (alerts look 24 h ahead and windows rarely
  // last over two days; an ongoing window is never re-alerted anyway, see below).
  for (const [k, t] of Object.entries(prev.notifiedWindows)) if (now - t < 72 * 3600_000) notified[k] = t;

  for (const { spot, wind } of entries) {
    // Muted spots never alert; never alert from stale (e.g. offline-cached) data, and do not let it
    // overwrite state.
    if (!alertEligible(spot, wind, settings, now)) continue;
    const sc = scoreWind(wind.current, spot.sectors, settings);
    const before = prev.ratings[spot.id];
    if (sc.rating === 'good' && before !== 'good' && (before !== undefined || opts.alertOnFirst)) {
      const c = wind.current;
      alerts.push({
        tag: `now-${spot.id}`,
        kind: 'now',
        spotId: spot.id,
        title: `${spot.name} is on`,
        body: `${formatSpeed(c.speedKn, settings.unit)} gusting ${formatSpeed(c.gustKn, settings.unit, false)} from ${compass(c.dirDeg)}`,
      });
    }
    ratings[spot.id] = sc.rating;

    if (settings.forecastAlerts) {
      const nowLocal = wind.current.time;
      // Scan from the start of the current hour, so a run that is already under way starts at or
      // before now (and is skipped) instead of looking like a new window starting next hour.
      const wins = goodWindows(wind.hourly, spot.sectors, settings, nowLocal.slice(0, 13) + ':00');
      for (const w of wins) {
        if (w.start <= nowLocal) continue; // already happening; covered by "now"
        const startMs = localIsoToEpoch(w.start, wind.utcOffsetSeconds);
        if (!(startMs > now && startMs - now <= horizon)) continue;
        const key = `${spot.id}@${w.start}/${w.end}`;
        if (notified[key]) continue;
        const seen = nearNotified(notified, spot.id, startMs, localIsoToEpoch(w.end, wind.utcOffsetSeconds), wind.utcOffsetSeconds);
        if (seen) {
          // Same session, shifted by a forecast update: track the new edges (keeping the original
          // notify time) so gradual drift over several checks still matches.
          notified[key] = seen;
          continue;
        }
        notified[key] = now;
        alerts.push({
          tag: `fc-${key}`,
          kind: 'forecast',
          spotId: spot.id,
          title: `Good window ahead: ${spot.name}`,
          body: `${relativeDay(w.start, nowLocal)} for ${w.hours}h, avg ${formatSpeed(w.avgKn, settings.unit)}`,
        });
        break; // one forecast alert per spot per check
      }
    }
  }
  return { alerts, next: { ratings, notifiedWindows: notified } };
}

/**
 * Undo the state changes of `undelivered` alerts only: their spots keep the previous rating ("now")
 * and their forecast windows are not marked notified, so they alert again on the next check.
 * Everything else in `next` is kept.
 */
export function rollback(prev: AlertState, next: AlertState, undelivered: Alert[]): AlertState {
  const ratings = { ...next.ratings };
  const notifiedWindows = { ...next.notifiedWindows };
  for (const a of undelivered) {
    if (a.kind === 'now') {
      if (prev.ratings[a.spotId] === undefined) delete ratings[a.spotId];
      else ratings[a.spotId] = prev.ratings[a.spotId];
    } else if (a.tag.startsWith('fc-')) {
      // Forecast alert tags are `fc-${windowKey}` (see computeAlerts).
      delete notifiedWindows[a.tag.slice(3)];
    }
  }
  return { ratings, notifiedWindows };
}
