/** A clockwise compass range [from, to] in degrees, may wrap past 360 (e.g. [300, 30]). */
export type Sector = [number, number];

export function normDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Smallest absolute angle between two bearings, 0..180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(normDeg(a) - normDeg(b));
  return d > 180 ? 360 - d : d;
}

/** True when `dir` lies within the clockwise sector from `s[0]` to `s[1]` (inclusive). */
export function inSector(dir: number, s: Sector): boolean {
  const d = normDeg(dir);
  const from = normDeg(s[0]);
  const to = normDeg(s[1]);
  // A sector spanning the full circle (e.g. [0, 360]).
  if (Math.abs(s[1] - s[0]) >= 360) return true;
  if (from <= to) return d >= from && d <= to;
  return d >= from || d <= to;
}

export function inAnySector(dir: number, sectors: readonly Sector[]): boolean {
  return sectors.some((s) => inSector(dir, s));
}

/** Angular distance from `dir` to the nearest edge of any sector; 0 when inside. */
export function distanceToSectors(dir: number, sectors: readonly Sector[]): number {
  if (sectors.length === 0) return Infinity;
  if (inAnySector(dir, sectors)) return 0;
  let best = 180;
  for (const s of sectors) best = Math.min(best, angleDiff(dir, s[0]), angleDiff(dir, s[1]));
  return best;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** 16-point compass label for a bearing. */
export function compass(deg: number): string {
  return POINTS[Math.round(normDeg(deg) / 22.5) % 16];
}

/** Human-readable list of sectors, e.g. "W–NW, E". */
export function describeSectors(sectors: readonly Sector[]): string {
  return sectors.map(([a, b]) => (compass(a) === compass(b) ? compass(a) : `${compass(a)}–${compass(b)}`)).join(', ');
}
