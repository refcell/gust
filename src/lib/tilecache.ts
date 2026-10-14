/**
 * Freshness rules for cached OpenStreetMap tiles (OSM tile usage policy: honour HTTP caching
 * headers, do not serve cached tiles forever). Pure functions; the service worker does the I/O.
 */

/** Header added to the cached copy of a tile: epoch ms when it was fetched from the network. */
export const FETCHED_HEADER = 'x-gust-fetched';
/** Lifetime when the response carries no readable Cache-Control max-age / Expires. */
export const DEFAULT_TILE_TTL_MS = 7 * 24 * 3600 * 1000;

interface HeaderLike {
  get(name: string): string | null;
}

/**
 * Freshness lifetime of a tile response in ms: Cache-Control `max-age` (0 for `no-cache` /
 * `no-store`), else `Expires` relative to `Date` (or to the fetch time), else DEFAULT_TILE_TTL_MS.
 */
export function tileLifetimeMs(headers: HeaderLike, fetchedAt: number): number {
  const cc = (headers.get('cache-control') ?? '').toLowerCase();
  if (/(^|[\s,])(no-cache|no-store)([\s,=]|$)/.test(cc)) return 0;
  const m = /(^|[\s,])max-age\s*=\s*"?(\d+)"?/.exec(cc);
  if (m) return Number(m[2]) * 1000;
  const expiresRaw = headers.get('expires');
  if (expiresRaw !== null) {
    const expires = Date.parse(expiresRaw);
    // Invalid Expires (e.g. "0") means already expired (RFC 9111 §5.3).
    if (!Number.isFinite(expires)) return 0;
    const date = Date.parse(headers.get('date') ?? '');
    return Math.max(0, expires - (Number.isFinite(date) ? date : fetchedAt));
  }
  return DEFAULT_TILE_TTL_MS;
}

/**
 * True while a cached tile may be served without contacting the network. Entries without a valid
 * FETCHED_HEADER (cached by older versions) are stale.
 */
export function isTileFresh(headers: HeaderLike, now: number): boolean {
  const fetchedAt = Number(headers.get(FETCHED_HEADER));
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0 || fetchedAt > now + 60_000) return false;
  return now - fetchedAt < tileLifetimeMs(headers, fetchedAt);
}
