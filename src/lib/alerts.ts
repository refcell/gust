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

/** For keys from older state (no end recorded): starts closer than this are the same session. */
export const SAME_START_MS = 3 * 3600_000;

/**
 * True when a window for this spot that was already notified overlaps [startMs, endMs]. Forecast
 * updates shift window edges between checks; an overlapping window is the same session, while a
 * separate session later the same day (no overlap) still alerts.
 */
function nearNotified(notified: Record<string, number>, spotId: string, startMs: number, endMs: number, utcOffsetSeconds: number): boolean {
  const prefix = `${spotId}@`;
  for (const k of Object.keys(notified)) {
    if (!k.startsWith(prefix)) continue;
    const [s0, e0] = k.slice(prefix.length).split('/');
    const a = localIsoToEpoch(s0, utcOffsetSeconds);
    if (!Number.isFinite(a)) continue;
    if (e0) {
      const b = localIsoToEpoch(e0, utcOffsetSeconds);
      if (Number.isFinite(b) && startMs <= b && a <= endMs) return true;
    } else if (Math.abs(a - startMs) < SAME_START_MS) return true;
  }
  return false;
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
  // Forget windows older than two days.
  for (const [k, t] of Object.entries(prev.notifiedWindows)) if (now - t < 48 * 3600_000) notified[k] = t;

  const muted = new Set(settings.muted ?? []);
  for (const { spot, wind } of entries) {
    if (muted.has(spot.id)) continue;
    // Never alert from stale (e.g. offline-cached) data, and do not let it overwrite state.
    if (isStale(wind, now)) continue;
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
      const wins = goodWindows(wind.hourly, spot.sectors, settings, nowLocal);
      for (const w of wins) {
        if (w.start <= nowLocal) continue; // already happening; covered by "now"
        const startMs = localIsoToEpoch(w.start, wind.utcOffsetSeconds);
        if (!(startMs > now && startMs - now <= horizon)) continue;
        const key = `${spot.id}@${w.start}/${w.end}`;
        if (notified[key]) continue;
        if (nearNotified(notified, spot.id, startMs, localIsoToEpoch(w.end, wind.utcOffsetSeconds), wind.utcOffsetSeconds)) continue;
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
