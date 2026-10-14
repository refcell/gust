import type { LatLon } from './geo';

/** Web Mercator (slippy map) math. Normalized coordinates are 0..1 across the world at any zoom. */
export const TILE = 256;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 15;
export const MAX_LAT = 85.0511287798;

export interface Pt {
  x: number;
  y: number;
}

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** World size in pixels at a (possibly fractional) zoom. */
export const worldSize = (z: number) => TILE * 2 ** z;

/** lat/lon -> normalized mercator (x east, y south), both 0..1. */
export function project(p: LatLon): Pt {
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat));
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: (p.lon + 180) / 360,
    y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI),
  };
}

/** Normalized mercator -> lat/lon. */
export function unproject(p: Pt): LatLon {
  const n = Math.PI * (1 - 2 * p.y);
  return { lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI, lon: p.x * 360 - 180 };
}

/** lat/lon -> world pixel at zoom z. */
export function toPixel(p: LatLon, z: number): Pt {
  const n = project(p);
  const w = worldSize(z);
  return { x: n.x * w, y: n.y * w };
}

/** World pixel at zoom z -> lat/lon. */
export function fromPixel(p: Pt, z: number): LatLon {
  const w = worldSize(z);
  return unproject({ x: p.x / w, y: p.y / w });
}

/** Tile containing a point at integer zoom z. */
export function toTile(p: LatLon, z: number): Pt {
  const px = toPixel(p, z);
  const n = 2 ** z;
  return { x: Math.min(n - 1, Math.floor(px.x / TILE)), y: Math.min(n - 1, Math.floor(px.y / TILE)) };
}

/** Ground metres per pixel at a latitude and zoom. */
export function metersPerPixel(lat: number, z: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / worldSize(z);
}

/** Centre (normalized) and zoom that fit all points into a w x h viewport with `pad` pixels of margin. */
export function fitBounds(points: LatLon[], w: number, h: number, pad = 24): { center: Pt; zoom: number } {
  const ps = points.map(project);
  const minX = Math.min(...ps.map((p) => p.x));
  const maxX = Math.max(...ps.map((p) => p.x));
  const minY = Math.min(...ps.map((p) => p.y));
  const maxY = Math.max(...ps.map((p) => p.y));
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const spanX = Math.max(maxX - minX, 1e-9) * TILE;
  const spanY = Math.max(maxY - minY, 1e-9) * TILE;
  const zoom = Math.log2(Math.min(Math.max(1, w - 2 * pad) / spanX, Math.max(1, h - 2 * pad) / spanY));
  return { center, zoom: clampZoom(zoom) };
}

/**
 * New normalized centre after zooming from z0 to z1 while keeping the point at viewport offset
 * (dx, dy) from the viewport centre fixed on screen.
 */
export function zoomAround(center: Pt, z0: number, z1: number, dx: number, dy: number): Pt {
  const fx = center.x + dx / worldSize(z0);
  const fy = center.y + dy / worldSize(z0);
  return { x: fx - dx / worldSize(z1), y: fy - dy / worldSize(z1) };
}

/** Wrap x into 0..1 and clamp y to 0..1. */
export function normalize(p: Pt): Pt {
  return { x: ((p.x % 1) + 1) % 1, y: Math.min(1, Math.max(0, p.y)) };
}

export interface TileRef {
  key: string;
  /** Tile coordinates to request (x wrapped). */
  z: number;
  x: number;
  y: number;
  /** Position and size in viewport pixels. */
  left: number;
  top: number;
  size: number;
}

/** Tiles covering a w x h viewport centred on `center` at fractional zoom `zoom`. */
export function visibleTiles(center: Pt, zoom: number, w: number, h: number): TileRef[] {
  const tz = Math.round(zoom);
  const n = 2 ** tz;
  const size = TILE * 2 ** (zoom - tz);
  const W = worldSize(zoom);
  const left = center.x * W - w / 2;
  const top = center.y * W - h / 2;
  const out: TileRef[] = [];
  const x0 = Math.floor(left / size);
  const x1 = Math.ceil((left + w) / size) - 1;
  const y0 = Math.max(0, Math.floor(top / size));
  const y1 = Math.min(n - 1, Math.ceil((top + h) / size) - 1);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const l = Math.round(tx * size - left);
      const t = Math.round(ty * size - top);
      out.push({
        key: `${tz}/${tx}/${ty}`,
        z: tz,
        x: ((tx % n) + n) % n,
        y: ty,
        left: l,
        top: t,
        size: Math.round((tx + 1) * size - left) - l,
      });
    }
  }
  return out;
}
