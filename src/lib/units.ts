export type SpeedUnit = 'kn' | 'mph' | 'ms' | 'kmh';

export const UNIT_LABEL: Record<SpeedUnit, string> = { kn: 'kn', mph: 'mph', ms: 'm/s', kmh: 'km/h' };

/** Multiply knots by this factor to get the unit. */
const PER_KNOT: Record<SpeedUnit, number> = { kn: 1, mph: 1.150779448, ms: 0.514444444, kmh: 1.852 };

export function fromKnots(kn: number, unit: SpeedUnit): number {
  return kn * PER_KNOT[unit];
}

export function toKnots(value: number, unit: SpeedUnit): number {
  return value / PER_KNOT[unit];
}

/** Round for display: one decimal for m/s, integers otherwise. */
export function formatSpeed(kn: number | null | undefined, unit: SpeedUnit, withLabel = true): string {
  if (kn == null || !Number.isFinite(kn)) return '–';
  const v = fromKnots(kn, unit);
  const s = unit === 'ms' ? v.toFixed(1) : String(Math.round(v));
  return withLabel ? `${s} ${UNIT_LABEL[unit]}` : s;
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return 'distance unknown';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
