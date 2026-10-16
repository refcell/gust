import { normDeg, type Sector } from './sectors';

export interface Point {
  x: number;
  y: number;
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0; // + 0 turns -0 into 0

/** Bearing (0° = north, clockwise) and radius to SVG x/y (y grows downwards) around (cx, cy). */
export function polarToXY(deg: number, r: number, cx = 0, cy = 0): Point {
  const a = (normDeg(deg) * Math.PI) / 180;
  return { x: r4(cx + r * Math.sin(a)), y: r4(cy - r * Math.cos(a)) };
}

/** True when the sector covers the whole circle, e.g. [0, 360]. */
export function isFullCircle([from, to]: Sector): boolean {
  return Math.abs(to - from) >= 360;
}

/** Clockwise span of a sector in degrees, 0..360. */
export function sectorSpan(s: Sector): number {
  return isFullCircle(s) ? 360 : normDeg(s[1] - s[0]);
}

/**
 * SVG path for a filled pie wedge from bearing `from` clockwise to `to` with radius `r` around (cx, cy).
 * Wraps past north (e.g. [300, 30]); a full circle ([0, 360]) becomes two half arcs; an empty span returns ''.
 */
export function sectorArcPath(from: number, to: number, r: number, cx = 0, cy = 0): string {
  if (isFullCircle([from, to])) {
    const top = polarToXY(0, r, cx, cy);
    const bottom = polarToXY(180, r, cx, cy);
    return `M${top.x} ${top.y}A${r} ${r} 0 1 1 ${bottom.x} ${bottom.y}A${r} ${r} 0 1 1 ${top.x} ${top.y}Z`;
  }
  const span = sectorSpan([from, to]);
  if (span === 0) return '';
  const a = polarToXY(from, r, cx, cy);
  const b = polarToXY(to, r, cx, cy);
  return `M${r4(cx)} ${r4(cy)}L${a.x} ${a.y}A${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${b.x} ${b.y}Z`;
}
