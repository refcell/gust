import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Badge } from './SpotCard';
import { RATING_LABEL, scoreWind, type Rating } from '../lib/score';
import { compass } from '../lib/sectors';
import { bestRating, clusterPoints, CLUSTER_PX } from '../lib/cluster';
import { clampZoom, fitBounds, metersPerPixel, normalize, project, visibleTiles, worldSize, zoomAround, MAX_ZOOM, MIN_ZOOM, type Pt } from '../lib/tiles';
import type { LatLon } from '../lib/geo';
import type { NearbySpot } from '../lib/spots';
import type { Settings, SpotWind } from '../lib/types';
import { formatDistance, formatSpeed } from '../lib/units';

export interface SpotMapProps {
  items: NearbySpot[];
  wind: Record<string, SpotWind>;
  settings: Settings;
  /** User location (drawn as a dot), if known. */
  user: LatLon | null;
  /** Centre of the radius circle (the user location, or the first place). */
  origin: LatLon;
  radiusKm: number;
  /** Extra points the initial view must include (e.g. nearest spots outside the radius). */
  fitExtra: LatLon[];
  onOpen: (id: string) => void;
}

/** Short visible rating text, so the marker does not rely on colour alone. */
const SHORT: Record<Rating, string> = { good: 'G', ok: 'OK', light: 'L', strong: 'S', offshore: 'X', poor: '–' };
const DRAG_PX = 6;
/** Arrow key -> pan direction (the view centre moves this way). */
const KEY_PAN: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

interface View {
  c: Pt;
  z: number;
}

export default function SpotMap({ items, wind, settings, user, origin, radiusKm, fitExtra, onOpen }: SpotMapProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Spots of a cluster tapped at max zoom, listed in the card. */
  const [listIds, setListIds] = useState<string[] | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const draggedRef = useRef(false);

  // Track the viewport size.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      addEventListener('resize', measure);
      return () => removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the initial view to the origin + radius (and any extra points) once the size is known.
  const fitKey = `${origin.lat},${origin.lon},${radiusKm},${fitExtra.map((p) => `${p.lat},${p.lon}`).join(';')}`;
  const fittedRef = useRef('');
  useEffect(() => {
    if (!size.w || !size.h || fittedRef.current === fitKey) return;
    fittedRef.current = fitKey;
    const dLat = radiusKm / 111.32;
    const dLon = radiusKm / (111.32 * Math.max(0.01, Math.cos((origin.lat * Math.PI) / 180)));
    const pts = [
      { lat: origin.lat + dLat, lon: origin.lon - dLon },
      { lat: origin.lat - dLat, lon: origin.lon + dLon },
      ...fitExtra,
    ];
    const f = fitBounds(pts, size.w, size.h, 28);
    setView({ c: f.center, z: f.zoom });
  }, [fitKey, size.w, size.h]);

  const zoomBy = (dz: number, dx = 0, dy = 0) => {
    const v = viewRef.current;
    if (!v) return;
    const z = clampZoom(v.z + dz);
    if (z === v.z) return;
    setView({ c: normalize(zoomAround(v.c, v.z, z, dx, dy)), z });
  };

  // Wheel zoom (non-passive so the page does not scroll) and pointer pan / pinch.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let pinchDist = 0;

    const offset = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return { dx: x - r.left - r.width / 2, dy: y - r.top - r.height / 2 };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { dx, dy } = offset(e.clientX, e.clientY);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      zoomBy(Math.max(-1, Math.min(1, (-e.deltaY * unit) / 300)), dx, dy);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if ((e.target as Element).closest('.map-ctrl, .map-attr')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        draggedRef.current = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        draggedRef.current = true;
        el.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const v = viewRef.current;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (!v) return;
      if (pointers.size === 1) {
        if (!draggedRef.current && start && Math.hypot(cur.x - start.x, cur.y - start.y) < DRAG_PX) return;
        if (!draggedRef.current) {
          draggedRef.current = true;
          // Capture only once dragging, so taps still reach marker buttons.
          el.setPointerCapture(e.pointerId);
        }
        const W = worldSize(v.z);
        setView({ c: normalize({ x: v.c.x - (cur.x - prev.x) / W, y: v.c.y - (cur.y - prev.y) / W }), z: v.z });
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && d > 0) {
          const mid = offset((a.x + b.x) / 2, (a.y + b.y) / 2);
          zoomBy(Math.log2(d / pinchDist), mid.dx, mid.dy);
        }
        pinchDist = d;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        start = p;
      }
      if (pointers.size === 0) start = null;
    };
    // Keyboard pan / zoom while the map surface itself has focus (marker buttons keep their keys).
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== el || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === '+' || e.key === '=') zoomBy(1);
      else if (e.key === '-' || e.key === '_') zoomBy(-1);
      else {
        const dir = KEY_PAN[e.key];
        const v = viewRef.current;
        if (!dir) return;
        e.preventDefault();
        if (!v) return;
        const { w, h } = sizeRef.current;
        const step = (Math.max(40, Math.min(w, h) / 4) * (e.shiftKey ? 3 : 1)) / worldSize(v.z);
        setView({ c: normalize({ x: v.c.x + dir[0] * step, y: v.c.y + dir[1] * step }), z: v.z });
        return;
      }
      e.preventDefault();
    };
    el.addEventListener('keydown', onKey);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const scored = useMemo(
    () =>
      [...items]
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .map((n) => {
          const w = wind[n.spot.id];
          return { n, w, sc: w ? scoreWind(w.current, n.spot.sectors, settings) : null, p: project(n.spot) };
        }),
    [items, wind, settings],
  );

  // Group markers closer than CLUSTER_PX on screen. World-pixel positions only change with zoom,
  // so panning reuses the result. x is periodic (world width) so spots across the antimeridian merge.
  const zoom = view?.z ?? 0;
  const clusters = useMemo(() => {
    const Wz = worldSize(zoom);
    return clusterPoints(
      scored.map((s) => ({ x: s.p.x * Wz, y: s.p.y * Wz, item: s })),
      CLUSTER_PX,
      Wz,
    );
  }, [scored, zoom]);
  const favs = new Set(settings.favorites ?? []);
  const atMax = !!view && view.z >= MAX_ZOOM - 1e-6;

  const openCluster = (members: typeof scored, keyboard: boolean) => {
    const v = viewRef.current;
    if (!v) return;
    if (v.z >= MAX_ZOOM - 1e-6) {
      setSelected(null);
      setListIds(members.map((m) => m.n.spot.id));
      return;
    }
    const f = fitBounds(
      members.map((m) => m.n.spot),
      sizeRef.current.w,
      sizeRef.current.h,
      60,
    );
    setView({ c: normalize(f.center), z: clampZoom(Math.max(v.z + 1, f.zoom)) });
    // The cluster button unmounts; keep keyboard focus on the first member's new marker.
    if (keyboard) {
      const id = CSS.escape(members[0].n.spot.id);
      requestAnimationFrame(() => surfaceRef.current?.querySelector<HTMLElement>(`[data-spot="${id}"], [data-spots~="${id}"]`)?.focus({ preventScroll: true }));
    }
  };

  const { w, h } = size;
  const W = view ? worldSize(view.z) : 0;
  /** Viewport position of a normalized point, choosing the nearest world copy horizontally. */
  const screen = (p: Pt) => {
    if (!view) return { x: -1e6, y: -1e6 };
    let dx = (p.x - view.c.x) * W;
    if (dx > W / 2) dx -= W;
    if (dx < -W / 2) dx += W;
    return { x: dx + w / 2, y: (p.y - view.c.y) * W + h / 2 };
  };
  const inView = (s: { x: number; y: number }) => s.x >= -8 && s.x <= w + 8 && s.y >= -8 && s.y <= h + 8;

  const sel = scored.find((s) => s.n.spot.id === selected);
  const list = sel || !listIds || !atMax ? [] : scored.filter((s) => listIds.includes(s.n.spot.id));
  const originPx = screen(project(origin));
  const radiusPx = view ? (radiusKm * 1000) / metersPerPixel(origin.lat, view.z) : 0;
  const userPx = user ? screen(project(user)) : null;

  return (
    <div class="map-wrap">
      <div class="map" ref={surfaceRef} role="region" tabIndex={0} aria-label="Map of nearby spots" aria-describedby="map-help">
        <p id="map-help" class="sr-only">
          Drag to pan, pinch or scroll to zoom. With the map focused, use the arrow keys to pan (Shift for bigger steps) and plus or minus to zoom. Use Tab to move between spot markers.
        </p>
        {view && (
          <>
            <div class="map-tiles" aria-hidden="true">
              {visibleTiles(view.c, view.z, w, h).map((t) => (
                <img
                  key={t.key}
                  class="map-tile"
                  src={`https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`}
                  alt=""
                  crossOrigin="anonymous"
                  draggable={false}
                  style={{ left: `${t.left}px`, top: `${t.top}px`, width: `${t.size}px`, height: `${t.size}px` }}
                />
              ))}
            </div>
            <div
              class="map-radius"
              aria-hidden="true"
              style={{ left: `${originPx.x - radiusPx}px`, top: `${originPx.y - radiusPx}px`, width: `${radiusPx * 2}px`, height: `${radiusPx * 2}px` }}
            />
            {userPx && inView(userPx) && <div class="map-user" role="img" aria-label="Your location" style={{ left: `${userPx.x}px`, top: `${userPx.y}px` }} />}
            {clusters.map((c) => {
              const s = screen({ x: c.x / W, y: c.y / W });
              if (!inView(s)) return null;
              const fav = c.items.some((m) => favs.has(m.n.spot.id));
              if (c.items.length > 1) {
                const best = bestRating(c.items.map((m) => m.sc?.rating));
                const ids = c.items.map((m) => m.n.spot.id);
                const label = `${c.items.length} spots, ${best ? `best ${RATING_LABEL[best]}` : 'no wind data yet'}${fav ? ', includes a favourite' : ''}. ${atMax ? 'Show list' : 'Zoom in'}`;
                return (
                  <button
                    key={`c:${ids[0]}`}
                    type="button"
                    class={`map-marker map-cluster b-${best ?? 'none'}${fav ? ' fav' : ''}${selected && ids.includes(selected) ? ' sel' : ''}`}
                    style={{ left: `${s.x}px`, top: `${s.y}px` }}
                    aria-label={label}
                    data-spots={ids.join(' ')}
                    onClick={(e) => {
                      if (draggedRef.current && e.detail !== 0) return;
                      openCluster(c.items, e.detail === 0);
                    }}
                  >
                    <span class="map-pin" aria-hidden="true">
                      {c.items.length}
                    </span>
                  </button>
                );
              }
              const { n, w: sw, sc } = c.items[0];
              const label =
                (sc ? `${n.spot.name}, ${RATING_LABEL[sc.rating]}, ${formatSpeed(sw!.current.speedKn, settings.unit)}` : `${n.spot.name}, no wind data yet`) +
                (fav ? ', favourite' : '');
              return (
                <button
                  key={n.spot.id}
                  type="button"
                  class={`map-marker b-${sc?.rating ?? 'none'}${fav ? ' fav' : ''}${selected === n.spot.id ? ' sel' : ''}`}
                  style={{ left: `${s.x}px`, top: `${s.y}px` }}
                  aria-label={label}
                  aria-pressed={selected === n.spot.id}
                  data-spot={n.spot.id}
                  onClick={(e) => {
                    // Ignore the click that ends a drag; keyboard activation (detail 0) always counts.
                    if (draggedRef.current && e.detail !== 0) return;
                    setListIds(null);
                    setSelected(selected === n.spot.id ? null : n.spot.id);
                  }}
                >
                  <span class="map-pin" aria-hidden="true">
                    {sc ? SHORT[sc.rating] : '?'}
                  </span>
                </button>
              );
            })}
          </>
        )}
        <div class="map-ctrl">
          <button type="button" class="map-zoom" aria-label="Zoom in" disabled={!view || view.z >= MAX_ZOOM} onClick={() => zoomBy(Math.floor(view!.z + 1e-6) + 1 - view!.z)}>
            +
          </button>
          <button type="button" class="map-zoom" aria-label="Zoom out" disabled={!view || view.z <= MIN_ZOOM} onClick={() => zoomBy(Math.ceil(view!.z - 1e-6) - 1 - view!.z)}>
            −
          </button>
        </div>
        <p class="map-attr small">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
            © OpenStreetMap contributors
          </a>
        </p>
      </div>
      <div class="map-card-slot" aria-live="polite">
        {sel ? (
          <div class={`map-card spot r-${sel.sc?.rating ?? 'none'}`} role="region" aria-label={`Selected: ${sel.n.spot.name}`}>
            <div class="map-card-head">
              <span class="spot-main">
                <span class="spot-name">
                  {favs.has(sel.n.spot.id) && (
                    <span class="fav-star" aria-label="Favourite" role="img">
                      ★
                    </span>
                  )}
                  {sel.n.spot.name}
                </span>
                <span class="spot-sub muted small">
                  {formatDistance(sel.n.distanceKm)}
                  {sel.w &&
                    ` · ${formatSpeed(sel.w.current.speedKn, settings.unit)} g${formatSpeed(sel.w.current.gustKn, settings.unit, false)} from ${compass(sel.w.current.dirDeg)}`}
                  {sel.sc && ` · ${sel.sc.score}/100`}
                </span>
              </span>
              {sel.sc ? <Badge rating={sel.sc.rating} /> : <span class="muted small">No data</span>}
            </div>
            <button type="button" class="btn small" onClick={() => onOpen(sel.n.spot.id)}>
              Open details
            </button>
          </div>
        ) : list.length ? (
          <div class="map-card spot" role="region" aria-label={`${list.length} spots here`}>
            <p class="small muted map-list-title">{list.length} spots at this point</p>
            <ul class="map-list">
              {list.map((m) => (
                <li key={m.n.spot.id}>
                  <button
                    type="button"
                    class="map-list-item"
                    onClick={() => {
                      setListIds(null);
                      setSelected(m.n.spot.id);
                    }}
                  >
                    <span class="spot-name">
                      {favs.has(m.n.spot.id) && (
                        <span class="fav-star" aria-label="Favourite" role="img">
                          ★
                        </span>
                      )}
                      {m.n.spot.name}
                    </span>
                    {m.sc ? <Badge rating={m.sc.rating} /> : <span class="muted small">No data</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p class="muted small map-hint">Tap a marker to see the spot, or a number to zoom in.</p>
        )}
      </div>
    </div>
  );
}
