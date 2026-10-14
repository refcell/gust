/** Open-Meteo local ISO time ("2026-06-01T14:00") at a fixed UTC offset -> epoch ms. */
export function localIsoToEpoch(iso: string, utcOffsetSeconds: number): number {
  return Date.parse(iso.length === 16 ? iso + ':00Z' : iso + 'Z') - utcOffsetSeconds * 1000;
}

/** Data older than this is treated as stale: shown with a notice and never used for alerts. */
export const STALE_AFTER_MS = 90 * 60_000;

export function isStale(w: { observedAt: number }, now = Date.now(), maxAgeMs = STALE_AFTER_MS): boolean {
  return !Number.isFinite(w.observedAt) || now - w.observedAt > maxAgeMs;
}

/** Offset (seconds east of UTC) of an IANA zone at an instant, or null if the zone is unknown. */
function zoneOffsetSeconds(timeZone: string, ms: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms));
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
    const off = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 1000);
    return Number.isFinite(off) ? off : null;
  } catch {
    return null;
  }
}

/**
 * Local ISO time -> epoch ms, honouring DST changes when the IANA zone is known (Open-Meteo's
 * `utc_offset_seconds` is a single offset for the whole response). Falls back to the fixed offset.
 */
export function localIsoToEpochInZone(iso: string, timeZone: string | undefined, utcOffsetSeconds: number): number {
  const fixed = localIsoToEpoch(iso, utcOffsetSeconds);
  if (!timeZone || timeZone === 'GMT' || timeZone === 'UTC') return fixed;
  const naive = localIsoToEpoch(iso, 0);
  const o1 = zoneOffsetSeconds(timeZone, fixed);
  if (o1 == null) return fixed;
  let ms = naive - o1 * 1000;
  const o2 = zoneOffsetSeconds(timeZone, ms);
  if (o2 != null && o2 !== o1) ms = naive - o2 * 1000;
  return ms;
}
