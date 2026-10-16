/**
 * Open-Meteo local ISO time ("2026-06-01T14:00") at a fixed UTC offset -> epoch ms. Open-Meteo
 * writes every timestamp in a response at its single `utc_offset_seconds`, even across a DST change
 * (verified against `timeformat=unixtime`), so a fixed offset is exact for API timestamps.
 */
export function localIsoToEpoch(iso: string, utcOffsetSeconds: number): number {
  return Date.parse(iso.length === 16 ? iso + ':00Z' : iso + 'Z') - utcOffsetSeconds * 1000;
}

/** Data older than this is treated as stale: shown with a notice and never used for alerts. */
export const STALE_AFTER_MS = 90 * 60_000;

export function isStale(w: { observedAt: number }, now = Date.now(), maxAgeMs = STALE_AFTER_MS): boolean {
  return !Number.isFinite(w.observedAt) || now - w.observedAt > maxAgeMs;
}

/** Epoch ms -> local ISO minute string ("2026-06-01T14:00") at a fixed UTC offset (inverse of localIsoToEpoch). */
export function epochToLocalIso(ms: number, utcOffsetSeconds: number): string {
  return new Date(ms + utcOffsetSeconds * 1000).toISOString().slice(0, 16);
}

/**
 * The local "now" (spot time, ISO minute) to read a forecast against. Fresh data uses the time of
 * its current sample (unchanged behaviour); stale data (e.g. served from the offline cache) uses
 * the wall clock in the response's UTC offset, so expired windows are not shown as current or
 * upcoming. Never earlier than the sample itself.
 */
export function forecastClock(
  w: { current: { time: string }; utcOffsetSeconds: number; observedAt: number },
  now = Date.now(),
): { nowIso: string; stale: boolean } {
  const stale = isStale(w, now);
  if (!stale) return { nowIso: w.current.time, stale };
  const wall = epochToLocalIso(now, w.utcOffsetSeconds || 0);
  return { nowIso: wall > w.current.time ? wall : w.current.time, stale };
}
