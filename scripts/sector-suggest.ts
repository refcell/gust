/**
 * Offline sector inference for curated spots with unknown sectors (`"sectors": []`).
 * Reuses the app's Overpass query/parsing (src/lib/overpass) and shore inference
 * (src/lib/coastline); this file only adds selection, politeness/retry, and review/apply helpers.
 * Pure except `politeFetch` / `inferAll`, whose I/O is injected (tests mock it).
 */
import { inferShoreDetailed, type ShoreFeature } from '../src/lib/coastline';
import { overpassPost, paddedBBox, parseShoreFeatures, buildShoreQuery, SHORE_PAD_KM, type KV } from '../src/lib/overpass';
import type { Sector } from '../src/lib/sectors';

export const USER_AGENT = 'gust (github.com/refcell/gust)';
/** Minimum gap between any two Overpass HTTP requests, ms. */
export const MIN_GAP_MS = 5_000;
/** Waits before each retry when an attempt was rate limited / timed out, ms. */
export const RETRY_BACKOFF_MS = [30_000, 60_000, 120_000];
/** `--apply` only takes suggestions at most this far from the nearest shore, m. */
export const APPLY_MAX_DISTANCE_M = 500;
export const APPLY_NOTE = ' OSM-inferred sectors.';
/** data/README: notes are at most 140 characters. */
export const MAX_NOTES = 140;

export interface CuratedSpot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  sectors?: Sector[];
  notes?: string;
  [k: string]: unknown;
}

export interface KnownSuggestion {
  id: string;
  name: string;
  lat: number;
  lon: number;
  normalDeg: number;
  sectors: Sector[];
  shoreKind: 'sea' | 'lake';
  distanceM: number;
  /** Human review decision; `--apply` only uses approved entries. */
  review?: 'approved' | 'rejected';
}

export interface UnknownSuggestion {
  id: string;
  reason: string;
}

export type Suggestion = KnownSuggestion | UnknownSuggestion;

export const isKnown = (s: Suggestion): s is KnownSuggestion => 'normalDeg' in s;

/** The suggestion was computed for the spot's current coordinates (stale after a spot moves). */
export const samePlace = (s: { lat: number; lon: number }, spot: { lat: number; lon: number }): boolean =>
  Math.abs(s.lat - spot.lat) < 1e-6 && Math.abs(s.lon - spot.lon) < 1e-6;

/** Curated spots whose rideable sectors are unknown (missing or empty). */
export function selectUnknown<T extends CuratedSpot>(spots: readonly T[]): T[] {
  return spots.filter((s) => !Array.isArray(s.sectors) || s.sectors.length === 0);
}

/** Review entry for one spot from the shore features around it (null = the request failed). */
export function suggestionFor(spot: CuratedSpot, features: readonly ShoreFeature[] | null): Suggestion {
  if (!features) return { id: spot.id, reason: 'overpass-request-failed' };
  const r = inferShoreDetailed(spot, features);
  if ('reason' in r) return { id: spot.id, reason: r.reason };
  return {
    id: spot.id,
    name: spot.name,
    lat: spot.lat,
    lon: spot.lon,
    normalDeg: Math.round(r.normalDeg) % 360,
    sectors: r.sectors.map(([a, b]) => [Math.round(a) % 360, Math.round(b) % 360] as Sector),
    shoreKind: r.kind === 'coastline' ? 'sea' : 'lake',
    distanceM: Math.round(r.distanceKm * 1000),
  };
}

/**
 * Apply suggestions to `spots` (returns a new array): only sea/lake suggestions within `maxDistanceM`
 * of the shore, and only to spots whose sectors are still unknown. Appends APPLY_NOTE to notes once.
 */
export function applySuggestions<T extends CuratedSpot>(
  spots: readonly T[],
  suggestions: readonly Suggestion[],
  maxDistanceM = APPLY_MAX_DISTANCE_M,
): { spots: T[]; applied: string[]; skipped: string[] } {
  const byId = new Map<string, KnownSuggestion>();
  for (const s of suggestions) {
    if (isKnown(s) && s.review === 'approved' && (s.shoreKind === 'sea' || s.shoreKind === 'lake') && s.distanceM <= maxDistanceM) byId.set(s.id, s);
  }
  const applied: string[] = [];
  const skipped: string[] = [];
  const out = spots.map((spot) => {
    const s = byId.get(spot.id);
    if (!s || selectUnknown([spot]).length === 0) return spot;
    const prev = spot.notes ?? '';
    const notes = prev.endsWith(APPLY_NOTE.trim()) ? prev : (prev + APPLY_NOTE).trim();
    if (!samePlace(s, spot)) {
      skipped.push(`${spot.id} (spot moved since inference)`);
      return spot;
    }
    if (notes.length > MAX_NOTES) {
      skipped.push(`${spot.id} (notes would exceed ${MAX_NOTES} characters)`);
      return spot;
    }
    applied.push(spot.id);
    return { ...spot, sectors: s.sectors.map((x) => [...x] as Sector), notes };
  });
  return { spots: out, applied, skipped };
}

/** Same one-entry-per-line layout as scripts/merge-spots.mjs. */
/** Merge new results over earlier ones by id (a later unknown never replaces an earlier inference). */
export function mergeResults(prev: readonly Suggestion[], next: readonly Suggestion[]): Suggestion[] {
  const byId = new Map(prev.map((p) => [p.id, p]));
  for (const n of next) {
    const p = byId.get(n.id);
    if (!p || isKnown(n) || !isKnown(p)) byId.set(n.id, n);
  }
  return [...byId.values()];
}

export function formatSpots(spots: readonly unknown[]): string {
  return '[\n' + spots.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n]\n';
}

export interface PoliteDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  minGapMs?: number;
}

/** A fetch that sets the User-Agent, keeps >= minGapMs between requests, and records statuses. */
export function politeFetch(d: PoliteDeps): { fetch: typeof fetch; statuses: (number | 'error')[] } {
  const gap = d.minGapMs ?? MIN_GAP_MS;
  let last = -Infinity;
  const statuses: (number | 'error')[] = [];
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const wait = last + gap - d.now();
    if (wait > 0) await d.sleep(wait);
    last = d.now();
    const headers = new Headers(init?.headers);
    headers.set('user-agent', USER_AGENT);
    try {
      const res = await d.fetch(input, { ...init, headers });
      statuses.push(res.status);
      return res;
    } catch (e) {
      statuses.push('error');
      throw e;
    } finally {
      last = d.now();
    }
  }) as typeof fetch;
  return { fetch: wrapped, statuses };
}

/** Storage that forgets everything: bypasses the app's per-device daily budget and backoff. */
const noStorage: KV = { getItem: () => null, setItem: () => undefined };

export interface InferDeps extends PoliteDeps {
  backoffMs?: readonly number[];
  log?: (msg: string) => void;
  /** Called after each spot with the results so far (lets the CLI save progress incrementally). */
  onResult?: (results: readonly Suggestion[]) => void;
}

/**
 * Shore features in the ~2 km box around `spot`: one Overpass query through the app's
 * `overpassPost` (endpoints in app order), retried with backoff after 429 / 504 / network errors.
 */
export async function fetchSpotFeatures(spot: CuratedSpot, http: ReturnType<typeof politeFetch>, d: InferDeps): Promise<ShoreFeature[] | null> {
  const query = buildShoreQuery(paddedBBox([spot], SHORE_PAD_KM));
  const backoff = d.backoffMs ?? RETRY_BACKOFF_MS;
  for (let attempt = 0; ; attempt++) {
    const from = http.statuses.length;
    // Busy instances queue requests before the 25 s query timeout starts, so allow 2 min per request.
    const json = await overpassPost(query, { fetch: http.fetch, storage: noStorage, now: d.now, timeoutMs: 120_000 });
    if (json !== null) return parseShoreFeatures(json);
    const seen = http.statuses.slice(from);
    const retryable = seen.some((s) => s === 429 || s === 504 || s === 'error');
    if (!retryable || attempt >= backoff.length) return null;
    d.log?.(`  ${spot.id}: ${seen.join(', ')}; retrying in ${backoff[attempt] / 1000}s`);
    await d.sleep(backoff[attempt]);
  }
}

/** One Overpass request (plus retries) per unknown spot, in order; never throws. */
export async function inferAll(spots: readonly CuratedSpot[], d: InferDeps): Promise<Suggestion[]> {
  const http = politeFetch(d);
  const out: Suggestion[] = [];
  for (const spot of selectUnknown(spots)) {
    let features: ShoreFeature[] | null;
    try {
      features = await fetchSpotFeatures(spot, http, d);
    } catch {
      features = null;
    }
    const s = suggestionFor(spot, features);
    d.log?.(isKnown(s) ? `${s.id}: ${s.shoreKind} faces ${s.normalDeg}° at ${s.distanceM} m -> ${JSON.stringify(s.sectors)}` : `${s.id}: unknown (${s.reason})`);
    out.push(s);
    d.onResult?.(out);
  }
  return out;
}
