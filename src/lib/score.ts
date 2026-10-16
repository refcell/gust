import { distanceToSectors, inAnySector, type Sector } from './sectors';
import type { Settings, WindSample } from './types';

export type Rating = 'good' | 'ok' | 'light' | 'strong' | 'offshore' | 'poor';
export type DirectionFit = 'rideable' | 'marginal' | 'offshore' | 'unknown';

export interface Score {
  /** 0..100 */
  score: number;
  rating: Rating;
  direction: DirectionFit;
  /** Short reason, e.g. "Offshore — unsafe". */
  reason: string;
}

/** Degrees outside a rideable sector that still count as marginal (cross-off). */
export const MARGINAL_DEG = 15;
/** Knots below the window that still count as "light but rideable for some". */
export const LIGHT_MARGIN_KN = 3;

export function directionFit(dirDeg: number, sectors: readonly Sector[] | undefined): DirectionFit {
  if (!sectors || sectors.length === 0) return 'unknown';
  if (inAnySector(dirDeg, sectors)) return 'rideable';
  return distanceToSectors(dirDeg, sectors) <= MARGINAL_DEG ? 'marginal' : 'offshore';
}

/**
 * Score a wind sample for a spot.
 *
 * - Offshore wind (outside every rideable sector by more than MARGINAL_DEG) is never good: rating `offshore`, score 0.
 * - `good` needs speed inside [minKn, maxKn], gusts <= maxGustKn, and a rideable direction.
 *   Unknown direction can reach `good` on speed alone (the UI marks direction as unknown).
 * - Marginal direction caps the rating at `ok`.
 */
export function scoreWind(w: Pick<WindSample, 'speedKn' | 'gustKn' | 'dirDeg'>, sectors: readonly Sector[] | undefined, s: Settings): Score {
  // Fail closed on missing or invalid data: never "good".
  if (!Number.isFinite(w.speedKn) || !Number.isFinite(w.dirDeg) || w.speedKn < 0) {
    return { score: 0, rating: 'poor', direction: 'unknown', reason: 'No data' };
  }
  if (!Number.isFinite(w.gustKn)) w = { ...w, gustKn: Infinity };
  const direction = directionFit(w.dirDeg, sectors);
  if (direction === 'offshore') return { score: 0, rating: 'offshore', direction, reason: 'Offshore — unsafe' };

  const { speedKn: v, gustKn: g } = w;
  const mid = (s.minKn + s.maxKn) / 2;
  const half = Math.max(1, (s.maxKn - s.minKn) / 2);

  let speed: number; // 0..1 fit
  let rating: Rating;
  let reason: string;

  if (v < s.minKn - LIGHT_MARGIN_KN) {
    speed = Math.max(0, v / (s.minKn - LIGHT_MARGIN_KN)) * 0.3;
    rating = 'poor';
    reason = 'Too light';
  } else if (v < s.minKn) {
    speed = 0.3 + (0.3 * (v - (s.minKn - LIGHT_MARGIN_KN))) / LIGHT_MARGIN_KN;
    rating = 'light';
    reason = 'A bit light';
  } else if (v <= s.maxKn) {
    // 0.7 at the edges, 1.0 in the middle of the window.
    speed = 1 - 0.3 * Math.min(1, Math.abs(v - mid) / half);
    rating = 'good';
    reason = 'In your window';
  } else {
    speed = Math.max(0, 0.6 - (v - s.maxKn) / 20);
    rating = 'strong';
    reason = 'Too strong';
  }

  if (g > s.maxGustKn) {
    speed *= 0.5;
    if (rating === 'good' || rating === 'light') {
      rating = 'strong';
      reason = 'Gusts too strong';
    }
  } else if (g - v > 12 && rating === 'good') {
    speed *= 0.85;
    reason = 'Gusty';
  }

  let dirFactor = 1;
  if (direction === 'marginal') {
    dirFactor = 0.6;
    if (rating === 'good') {
      rating = 'ok';
      reason = 'Cross-offshore edge';
    }
  } else if (direction === 'unknown') {
    dirFactor = 0.85;
  }

  return { score: Math.round(100 * speed * dirFactor), rating, direction, reason };
}

export const RATING_LABEL: Record<Rating, string> = {
  good: 'Good',
  ok: 'OK',
  light: 'Light',
  strong: 'Strong',
  offshore: 'Offshore',
  poor: 'No wind',
};
