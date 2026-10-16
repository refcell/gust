import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { loadCuratedSpots } from './data';
import { SpotCard } from './SpotCard';
import { SettingsPanel } from './SettingsPanel';
import { AlertsPanel } from './AlertsPanel';
import { PlacesPanel } from './PlacesPanel';
import { Welcome } from './Welcome';
import { runCheck, K, notificationOptions } from '../lib/check';
import { spotsOn, type Alert } from '../lib/alerts';
import { kvGet } from '../lib/kv';
import { fetchSpotWind, splitFresh } from '../lib/openmeteo';
import { createCoalescer } from '../lib/coalesce';
import { nearbySpots, nearestSpots, type NearbySpot } from '../lib/spots';
import { scoreWind } from '../lib/score';
import { loadFavSpots, loadLastLocation, loadPlaces, loadSettings, saveFavSpots, saveLastLocation, savePlaces, saveSettings } from '../lib/settings';
import { DEFAULT_SETTINGS, type Place, type Settings, type Spot, type SpotWind } from '../lib/types';
import type { LatLon } from '../lib/geo';
import { detectPlatform } from '../lib/platform';
import { augmentAround } from './osm';
import { persistBackground, pushConfigured, requestAlerts, showLocalNotification, syncPush } from './background';
import { nextRevision, syncKey } from '../lib/pushsync';
import { isStale } from '../lib/time';
import { formatSpeed } from '../lib/units';
import { backfillFavoriteSnapshots, favoriteItems, favoritesFirst, toggleFavoriteSnapshot, watchSets, withFavoriteSnapshots } from '../lib/watch';

type LocStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'error' | 'unsupported';
type View = 'spots' | 'places' | 'alerts' | 'settings';
type SpotsMode = 'list' | 'map';
const MODE_KEY = 'gust.spotsMode';
interface Loc extends LatLon {
  at: number;
  label?: string;
  source: 'gps' | 'demo' | 'last';
}

/** Re-check wind on resume when the last fetch is older than this (same as the reuse window). */
const STALE_MS = 10 * 60_000;
const DEMO: Loc = { lat: 37.8043, lon: -122.4659, at: 0, label: 'San Francisco (demo)', source: 'demo' };

const TABS: [View, string][] = [
  ['spots', 'Spots'],
  ['places', 'Places'],
  ['alerts', 'Alerts'],
  ['settings', 'Settings'],
];

interface Group {
  key: string;
  title: string;
  items: NearbySpot[];
  fallback: boolean;
}

export function App() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const demo = params.has('demo');
  const platform = useMemo(() => detectPlatform(), []);

  // Demo mode (the landing page iframe) is isolated from the user's state: it reads nothing
  // user-specific from storage and writes nothing (settings, places, favourites, alert state,
  // background watch lists, last location), and never asks for or shows notifications.
  const [settings, setSettings] = useState<Settings>(() => (demo ? DEFAULT_SETTINGS : loadSettings()));
  const [places, setPlaces] = useState<Place[]>(() => (demo ? [] : loadPlaces()));
  const [loc, setLoc] = useState<Loc | null>(() => {
    if (demo) return DEMO;
    const last = loadLastLocation();
    return last ? { ...last, source: 'last' } : null;
  });
  const [locStatus, setLocStatus] = useState<LocStatus>('idle');
  const [curated, setCurated] = useState<Spot[] | null>(null);
  const [osm, setOsm] = useState<Spot[]>([]);
  // Snapshots of favourited spots: favourites stay watched when they drop out of the OSM data.
  const [favSpots, setFavSpots] = useState<Spot[]>(() => (demo ? [] : loadFavSpots()));
  // Stored favourite snapshots; in demo mode the in-memory list stands in for storage.
  const readFavSpots = () => (demo ? favSpots : loadFavSpots());
  const [wind, setWind] = useState<Record<string, SpotWind>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number>(0);
  // Spots whose last wind request failed (their previous samples are kept); retried each minute.
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [view, setView] = useState<View>('spots');
  const [openId, setOpenId] = useState<string | null>(params.get('spot'));
  const [online, setOnline] = useState(navigator.onLine);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const [spotsMode, setSpotsModeState] = useState<SpotsMode>(() => (!demo && localStorage.getItem(MODE_KEY) === 'map' ? 'map' : 'list'));
  const [MapView, setMapView] = useState<typeof import('./SpotMap').default | null>(null);
  const [mapError, setMapError] = useState(false);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(() => localStorage.getItem('gust.alertBanner') === 'dismissed');

  // Load the curated dataset once.
  useEffect(() => {
    loadCuratedSpots()
      .then(setCurated)
      .catch(() => setError('Could not load the spot list. Check your connection and reload.'));
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocStatus('unsupported');
      return;
    }
    setLocStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const l: Loc = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now(), source: 'gps' };
        if (!demo) saveLastLocation(l);
        setLoc(l);
        setLocStatus('ok');
      },
      (e) => setLocStatus(e.code === e.PERMISSION_DENIED ? 'denied' : 'error'),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  }, [demo]);

  // Refresh GPS automatically when permission was already granted (no prompt).
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((st) => {
        if (!cancelled && st.state === 'granted') locate();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [demo, locate]);

  const allSpots = useMemo(
    // Snapshots are read from storage (kept current by the effect below); `favSpots` only bumps
    // the memo when a favourite is toggled.
    () => (curated ? withFavoriteSnapshots([...curated, ...osm], settings.favorites, readFavSpots()) : null),
    [curated, osm, settings.favorites, favSpots],
  );

  // Keep stored favourite snapshots current: add missing ones and refresh changed ones while the
  // spot is loaded (storage only; `allSpots` reads storage when the dataset changes).
  useEffect(() => {
    if (!allSpots || demo) return;
    const next = backfillFavoriteSnapshots(loadFavSpots(), allSpots, settings.favorites);
    if (next) saveFavSpots(next);
  }, [allSpots, settings.favorites, demo]);

  // Augment with OpenStreetMap spots around the current location and the saved places.
  const osmKey = [loc, ...places].map((p) => (p ? `${p.lat.toFixed(3)},${p.lon.toFixed(3)}` : '')).join('|');
  useEffect(() => {
    if (!curated || demo) return;
    const origins: LatLon[] = loc ? [loc, ...places] : places;
    if (origins.length === 0) return;
    let cancelled = false;
    augmentAround(origins, settings.radiusKm, curated)
      .then((extra) => {
        if (!cancelled) setOsm(extra);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [osmKey, settings.radiusKm, curated, demo]);

  const groups: Group[] = useMemo(() => {
    if (!allSpots) return [];
    const out: Group[] = [];
    if (loc) {
      const items = nearbySpots(allSpots, loc, settings.radiusKm);
      out.push(
        items.length
          ? { key: 'here', title: loc.source === 'demo' ? (loc.label ?? 'Demo') : 'Near you', items, fallback: false }
          : { key: 'here', title: 'Nearest spots', items: nearestSpots(allSpots, loc, 5), fallback: true },
      );
    }
    for (const p of places) {
      const items = nearbySpots(allSpots, p, settings.radiusKm);
      out.push(
        items.length
          ? { key: p.id, title: `Near ${p.name}`, items, fallback: false }
          : { key: p.id, title: `Nearest to ${p.name}`, items: nearestSpots(allSpots, p, 3), fallback: true },
      );
    }
    // Favourites no other section shows (outside the radius) keep their own section.
    const favs = favoriteItems(allSpots, settings.favorites, out, loc ?? places[0] ?? null);
    if (favs.length) out.push({ key: 'fav', title: 'Favourites', items: favs, fallback: false });
    return out;
  }, [allSpots, loc, places, settings.radiusKm, settings.favorites]);

  // Spots inside the radius and all favourites are watched for alerts; other fallback spots
  // (nearest, outside the radius) are only shown.
  const { watched, shownOnly } = useMemo(() => watchSets(groups, settings.favorites), [groups, settings.favorites]);
  const watchKey = [...watched, ...shownOnly].map((s) => s.id).join('|');

  // Latest state for the refresh runner (it is created once; see `refresh` below).
  const windRef = useRef(wind);
  windRef.current = wind;
  const failedRef = useRef(failedIds);
  failedRef.current = failedIds;
  const doRefresh = async (force: boolean) => {
    const all = [...watched, ...shownOnly];
    if (all.length === 0) return;
    // Reuse samples fetched in the last 10 minutes (scoring-only changes: wind window, units,
    // mute, favourites); fetch only missing or older ones plus spots whose last request failed.
    // `force` (Refresh button) refetches all.
    const { fresh, missing } = force ? { fresh: {} as Record<string, SpotWind>, missing: all } : splitFresh(all, windRef.current, Date.now(), undefined, failedRef.current);
    const fetching = missing.length > 0;
    if (fetching) setLoading(true);
    setError(null);
    try {
      const granted = !demo && 'Notification' in window && Notification.permission === 'granted';
      // Demo mode only shows wind: every spot is fetched directly, nothing is checked or persisted.
      const checked = demo ? [] : watched;
      const extraSpots = [...(demo ? watched : []), ...shownOnly].filter((s) => !fresh[s.id]);
      // Alert state is committed per alert, only once its notification was shown (see runCheck).
      const deliver = granted ? (a: Alert) => showLocalNotification(a.title, notificationOptions(a)) : undefined;
      const [check, extra] = await Promise.all([
        checked.length ? runCheck({ spots: checked, settings, deliver, cached: fresh }) : Promise.resolve({ wind: {} as Record<string, SpotWind>, failedIds: [] as string[] }),
        fetchSpotWind(extraSpots),
      ]);
      const w: Record<string, SpotWind> = { ...check.wind, ...extra.wind };
      for (const s of all) if (fresh[s.id] && !w[s.id]) w[s.id] = fresh[s.id];
      const failed = [...new Set([...check.failedIds, ...extra.failedIds])];
      setFailedIds(failed);
      // Nothing usable, or every request failed: an error, not an update.
      if (Object.keys(w).length === 0 || (fetching && failed.length >= missing.length)) throw new Error('no data');
      // Failed spots keep their previous samples.
      setWind((prev) => ({ ...prev, ...w }));
      if (fetching) setFetchedAt(Date.now());
    } catch {
      setError(navigator.onLine ? 'Could not reach the wind service. Retrying in a minute.' : 'Offline — showing the last wind data.');
      const last = demo ? undefined : await kvGet<Record<string, SpotWind>>(K.lastWind).catch(() => undefined);
      if (last) setWind((prev) => ({ ...last, ...prev }));
    } finally {
      if (fetching) setLoading(false);
    }
  };
  const doRefreshRef = useRef(doRefresh);
  doRefreshRef.current = doRefresh;
  // One refresh in flight at a time; a request during it schedules one follow-up with the latest state.
  const refresh = useMemo(() => createCoalescer((force) => doRefreshRef.current(force)), []);

  // Re-check whenever the watched set or settings change (reusing fresh samples).
  useEffect(() => {
    refresh();
  }, [watchKey, settings, refresh]);

  // After a failed fetch (rate limit, flaky network), retry once a minute while online.
  // Partial failures retry only the failed spots (fresh samples of the others are reused).
  useEffect(() => {
    if ((!error && failedIds.length === 0) || !online || loading) return;
    const t = setTimeout(() => refresh(), 65_000);
    return () => clearTimeout(t);
  }, [error, failedIds, online, loading, refresh]);

  // Keep the background copies of the settings and watched spots in sync, on their own (not on the
  // wind fetch), so muting takes effect even while the fetch is failing: IndexedDB for the service
  // worker right away, the push backend (muted spots excluded) debounced. Each change gets a new
  // revision; older revisions are dropped before they are saved or posted. Skipped until the spot
  // list has loaded (an empty watch list would wipe the background copies).
  const locRef = useRef(loc);
  locRef.current = loc;
  const origins: LatLon[] = useMemo(() => (loc ? [loc, ...places] : places), [loc, places]);
  const originsRef = useRef(origins);
  originsRef.current = origins;
  const bgKey = curated && !demo ? syncKey(settings, watched) : '';
  useEffect(() => {
    if (!bgKey) return;
    const intent = { rev: nextRevision(), settings, watched, loc: locRef.current, origins: originsRef.current };
    persistBackground(intent).catch(() => undefined);
    if (!pushConfigured) return;
    const t = setTimeout(() => {
      syncPush(intent).catch(() => undefined);
    }, 1500);
    return () => clearTimeout(t);
  }, [bgKey]);

  // Deep links (?spot=id, used by notifications): scroll the spot into view once it renders.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !openId || !fetchedAt) return;
    const el = document.getElementById(`spot-${openId}`)?.closest('li');
    if (el) {
      scrolledRef.current = true;
      el.scrollIntoView({ block: 'center' });
    }
  }, [openId, fetchedAt]);

  const setSpotsMode = (m: SpotsMode) => {
    setSpotsModeState(m);
    if (!demo) localStorage.setItem(MODE_KEY, m);
  };

  // The map is a separate chunk, loaded only when the map view is first shown.
  useEffect(() => {
    if (spotsMode !== 'map' || MapView) return;
    let cancelled = false;
    setMapError(false);
    import('./SpotMap')
      .then((m) => {
        if (!cancelled) setMapView(() => m.default);
      })
      .catch(() => {
        if (!cancelled) setMapError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [spotsMode, MapView]);

  // "Open details" from the map: once the list renders, scroll the spot into view and focus it.
  useEffect(() => {
    if (!scrollTo || spotsMode !== 'list') return;
    const li = document.getElementById(`spot-${scrollTo}`)?.closest('li');
    if (!li) return;
    setScrollTo(null);
    li.scrollIntoView({ block: 'center' });
    li.querySelector<HTMLElement>('.spot-head')?.focus({ preventScroll: true });
  });

  // Re-check on resume (the main alert path on iOS).
  const fetchedRef = useRef(fetchedAt);
  fetchedRef.current = fetchedAt;
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - fetchedRef.current > STALE_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(onVis, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, [refresh]);

  const enableAlerts = async () => {
    if (demo) return;
    const r = await requestAlerts({ settings, watched, loc, origins });
    setNotifPerm(r.perm);
    if (r.perm !== 'granted') return;
    // Confirm right away, listing spots that are already on (and would alert: not muted or stale).
    const on = spotsOn(watched, wind, settings);
    const body = on.length
      ? on
          .slice(0, 3)
          .map(({ spot, w }) => `${spot.name} ${formatSpeed(w.current.speedKn, settings.unit)}`)
          .join(' · ')
      : watched.length
        ? `Watching ${watched.length} spots. You will get a notification when one turns good.`
        : 'Share your location or add a place, and gust will tell you when a spot turns good.';
    await showLocalNotification(on.length ? `${on.length} spot${on.length > 1 ? 's are' : ' is'} on now` : 'Alerts are on', {
      body,
      tag: 'gust-enabled',
      icon: __BASE__ + 'icons/icon-192.png',
      data: { url: __BASE__ + 'app/' },
    });
  };
  const dismissBanner = () => {
    localStorage.setItem('gust.alertBanner', 'dismissed');
    setBannerDismissed(true);
  };
  const iosNeedsInstall = platform.ios && !platform.standalone;
  const partialNote = !error && failedIds.length ? ` · ${failedIds.length} ${failedIds.length === 1 ? 'spot' : 'spots'} failed, retrying` : '';
  const showWelcome = !demo && !loc && places.length === 0;
  const showBanner = !showWelcome && !demo && !bannerDismissed && notifPerm === 'default' && watched.length > 0 && !iosNeedsInstall;

  const updateSettings = (s: Settings) => {
    setSettings(s);
    if (!demo) saveSettings(s);
  };
  const updatePlaces = (p: Place[]) => {
    setPlaces(p);
    if (!demo) savePlaces(p);
  };
  /** (Un)favourite a spot: settings plus the stored snapshot that keeps it watched anywhere. */
  const toggleFavorite = (spot: Spot, f: boolean) => {
    const rest = (settings.favorites ?? []).filter((id) => id !== spot.id);
    const snaps = toggleFavoriteSnapshot(readFavSpots(), spot, f);
    if (!demo) saveFavSpots(snaps);
    setFavSpots(snaps);
    updateSettings({ ...settings, favorites: f ? [...rest, spot.id] : rest });
  };

  // Oldest sample among watched spots, if any is stale (e.g. served from the offline cache).
  const staleAt = (() => {
    const ws = [...watched, ...shownOnly].map((s) => wind[s.id]).filter(Boolean) as SpotWind[];
    const stale = ws.filter((w) => isStale(w));
    return stale.length ? Math.min(...stale.map((w) => w.observedAt || w.fetchedAt)) : 0;
  })();

  /** Switch section; `focusSel` moves keyboard focus into the new panel once it renders. */
  const selectView = (v: View, focusSel?: string) => {
    // A new tab starts at its top, not at the previous tab's scroll offset.
    if (v !== view) window.scrollTo(0, 0);
    setView(v);
    if (focusSel) requestAnimationFrame(() => document.querySelector<HTMLElement>(focusSel)?.focus());
  };
  // Tabs pattern: arrows / Home / End move between tabs and activate them.
  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex(([v]) => v === view);
    const n = TABS.length;
    const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const v = TABS[next][0];
    if (v !== view) window.scrollTo(0, 0);
    setView(v);
    document.getElementById(`tab-${v}`)?.focus();
  };

  // Map data: every shown spot once, centred on the user (or the first place).
  const mapItems = useMemo(() => {
    const seen = new Map<string, NearbySpot>();
    for (const g of groups) for (const n of g.items) if (!seen.has(n.spot.id)) seen.set(n.spot.id, n);
    return [...seen.values()];
  }, [groups]);
  const listedIds = useMemo(() => new Set(mapItems.map((n) => n.spot.id)), [mapItems]);
  const mapOrigin: LatLon | null = loc ?? places[0] ?? null;
  const mapFitExtra = useMemo(() => (groups[0]?.fallback ? groups[0].items.map((n) => ({ lat: n.spot.lat, lon: n.spot.lon })) : []), [groups]);
  const openFromMap = (id: string) => {
    setOpenId(id);
    setScrollTo(id);
    setSpotsMode('list');
  };
  /** "Show" from the Places search: switch to the Spots list and scroll to the spot. */
  const showSpot = (id: string) => {
    openFromMap(id);
    setView('spots');
  };

  const sortItems = (items: NearbySpot[]) =>
    favoritesFirst(items, settings.favorites, (a, b) => {
      const wa = wind[a.spot.id];
      const wb = wind[b.spot.id];
      const sa = wa ? scoreWind(wa.current, a.spot.sectors, settings).score : -1;
      const sb = wb ? scoreWind(wb.current, b.spot.sectors, settings).score : -1;
      return sb - sa || a.distanceKm - b.distanceKm;
    });

  return (
    <div class="shell">
      <header class="top">
        <h1 class="brand-h">
          <a class="brand" href={__BASE__}>
            gust
          </a>
        </h1>
        <span class="status" aria-live="polite">
          {loading ? 'Updating…' : fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${partialNote}` : ''}
          {!online && ' · offline'}
        </span>
        <button class="icon-btn" onClick={() => refresh(true)} disabled={loading || watched.length + shownOnly.length === 0} aria-label="Refresh wind">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </header>

      <main id="main">
        <div role="tabpanel" id="panel" aria-labelledby={`tab-${view}`}>
        {view === 'spots' && (
          <>
            {showWelcome ? (
              <Welcome
                locStatus={locStatus}
                onLocate={locate}
                notifPerm={notifPerm}
                onEnableAlerts={enableAlerts}
                iosNeedsInstall={iosNeedsInstall}
                onAddPlace={() => selectView('places', '#place-q')}
              />
            ) : (
              <LocationBar loc={loc} status={locStatus} onLocate={locate} demo={demo} />
            )}
            {!showWelcome && mapOrigin && (
              <div class="seg mode" role="group" aria-label="Show spots as">
                {(['list', 'map'] as const).map((m) => (
                  <button key={m} type="button" class={spotsMode === m ? 'on' : ''} aria-pressed={spotsMode === m} onClick={() => setSpotsMode(m)}>
                    {m === 'list' ? 'List' : 'Map'}
                  </button>
                ))}
              </div>
            )}
            {showBanner && (
              <div class="banner" role="region" aria-label="Alerts">
                <p class="small">Get a notification when a spot near you turns good.</p>
                <div class="banner-actions">
                  <button class="btn small" onClick={enableAlerts}>
                    Enable alerts
                  </button>
                  <button class="btn ghost small" onClick={dismissBanner}>
                    Not now
                  </button>
                </div>
              </div>
            )}
            {error && (
              <p class="notice" role="status">
                {error}
              </p>
            )}
            {staleAt > 0 && (
              <p class="notice" role="status">
                Showing cached wind from {new Date(staleAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}. Scores may be out of date.
              </p>
            )}
            {!allSpots && !error && !showWelcome && <p class="muted">Loading spots…</p>}
            {spotsMode === 'map' && !showWelcome && mapOrigin && allSpots && (
              MapView ? (
                <MapView
                  items={mapItems}
                  wind={wind}
                  settings={settings}
                  user={loc}
                  origin={mapOrigin}
                  radiusKm={settings.radiusKm}
                  fitExtra={mapFitExtra}
                  onOpen={openFromMap}
                />
              ) : (
                <p class="muted" role="status">
                  {mapError ? 'Could not load the map. Check your connection.' : 'Loading map…'}
                </p>
              )
            )}
            {spotsMode === 'list' && groups.length > 0 && !fetchedAt && !error && (
              // Same section/heading structure as the loaded list, so the swap does not shift layout.
              <div aria-label={`Checking wind at ${watched.length + shownOnly.length} spots`} role="status">
                {groups.slice(0, 2).map((g) => (
                  <section key={g.key} class="group" aria-label={g.title}>
                    <h2>
                      {g.title}
                      {g.fallback && <span class="muted small"> · none within {settings.radiusKm} km</span>}
                    </h2>
                    <ul class="spots skeleton">
                      {sortItems(g.items).slice(0, 6).map((n) => (
                        <li key={n.spot.id} class="spot">
                          <div class="spot-head">
                            <span class="spot-main">
                              <span class="spot-name">{n.spot.name}</span>
                              <span class="spot-sub muted small">Checking wind…</span>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {spotsMode === 'list' && (fetchedAt > 0 || error) && groups.map((g) => (
              <section key={g.key} class="group" aria-label={g.title}>
                <h2>
                  {g.title}
                  {g.fallback && <span class="muted small"> · none within {settings.radiusKm} km</span>}
                </h2>
                <ul class="spots">
                  {sortItems(g.items).map((n) => (
                    <SpotCard
                      key={n.spot.id}
                      spot={n.spot}
                      distanceKm={n.distanceKm}
                      wind={wind[n.spot.id]}
                      settings={settings}
                      open={openId === n.spot.id}
                      onToggle={() => setOpenId(openId === n.spot.id ? null : n.spot.id)}
                      muted={settings.muted?.includes(n.spot.id)}
                      onMute={(m) => {
                        const rest = (settings.muted ?? []).filter((id) => id !== n.spot.id);
                        updateSettings({ ...settings, muted: m ? [...rest, n.spot.id] : rest });
                      }}
                      favorite={settings.favorites?.includes(n.spot.id)}
                      onFavorite={(f) => toggleFavorite(n.spot, f)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
        {view === 'places' && (
          <PlacesPanel
            places={places}
            onChange={updatePlaces}
            loc={loc}
            spots={curated}
            favorites={settings.favorites ?? []}
            onFavorite={toggleFavorite}
            listedIds={listedIds}
            onShow={showSpot}
          />
        )}
        {view === 'alerts' && demo && (
          <section class="panel" aria-label="Alerts">
            <h2>Alerts</h2>
            <p class="muted">Alerts are off in the demo. Open the app to get notified when a spot near you turns good.</p>
          </section>
        )}
        {view === 'alerts' && !demo && <AlertsPanel platform={platform} settings={settings} onSettings={updateSettings} watched={watched} loc={loc} origins={origins} places={places} wind={wind} />}
        {view === 'settings' && <SettingsPanel settings={settings} onChange={updateSettings} />}
        </div>
      </main>

      <nav class="tabs" aria-label="Sections">
        <div class="tablist" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
          {TABS.map(([v, label]) => (
            <button
              key={v}
              id={`tab-${v}`}
              role="tab"
              class={view === v ? 'tab active' : 'tab'}
              aria-selected={view === v}
              aria-controls="panel"
              tabIndex={view === v ? 0 : -1}
              onClick={() => selectView(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function LocationBar(props: { loc: Loc | null; status: LocStatus; onLocate: () => void; demo: boolean }) {
  const { loc, status, onLocate, demo } = props;
  if (demo) return <p class="locbar muted small">Demo mode · fixed location, live wind</p>;
  let text: string;
  switch (status) {
    case 'locating':
      text = 'Finding your location…';
      break;
    case 'denied':
      text = 'Location is blocked. Allow it in your browser settings, or add a place.';
      break;
    case 'error':
      text = 'Could not get your location.';
      break;
    case 'unsupported':
      text = 'This browser cannot share location. Add a place instead.';
      break;
    default:
      text = loc ? (loc.source === 'gps' ? 'Using your current location' : `Using last known location (${ago(loc.at)})`) : 'Location not shared yet';
  }
  return (
    <div class="locbar">
      <span class="small muted">{text}</span>
      {status !== 'locating' && status !== 'unsupported' && (
        <button class={loc ? 'btn ghost small' : 'btn'} onClick={onLocate}>
          {loc ? 'Update' : 'Use my location'}
        </button>
      )}
    </div>
  );
}

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
