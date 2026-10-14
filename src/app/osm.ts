import type { LatLon } from '../lib/geo';
import type { Spot } from '../lib/types';

/**
 * Placeholder: OpenStreetMap augmentation (sport=kitesurfing via Overpass) lands in a later increment.
 * Returns extra spots not already covered by the curated list.
 */
export async function augmentWithOsm(_center: LatLon, _radiusKm: number, _curated: Spot[]): Promise<Spot[]> {
  return [];
}
