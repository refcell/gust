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
