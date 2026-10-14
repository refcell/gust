import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { loadCuratedSpots } from './data';
import { SpotCard } from './SpotCard';
import { SettingsPanel } from './SettingsPanel';
import { AlertsPanel } from './AlertsPanel';
import { PlacesPanel } from './PlacesPanel';
import { runCheck, K, notificationOptions } from '../lib/check';
import { kvGet, kvSet } from '../lib/kv';
import { fetchWind } from '../lib/openmeteo';
import { nearbySpots, nearestSpots, type NearbySpot } from '../lib/spots';
import { scoreWind } from '../lib/score';
import { loadLastLocation, loadPlaces, loadSettings, saveLastLocation, savePlaces, saveSettings } from '../lib/settings';
import type { Place, Settings, Spot, SpotWind } from '../lib/types';
import type { LatLon } from '../lib/geo';
import { detectPlatform } from '../lib/platform';
import { augmentWithOsm } from './osm';
import { enableBackground, requestAlerts, showLocalNotification } from './background';
import { isStale } from '../lib/time';
import { formatSpeed } from '../lib/units';

type LocStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'error' | 'unsupported';
type View = 'spots' | 'places' | 'alerts' | 'settings';
interface Loc extends LatLon {
  at: number;
  label?: string;
  source: 'gps' | 'demo' | 'last';
}

/** Re-check wind on resume when the last fetch is older than this. */
const STALE_MS = 10 * 60_000;
const DEMO: Loc = { lat: 37.8043, lon: -122.4659, at: 0, label: 'San Francisco (demo)', source: 'demo' };

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

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [places, setPlaces] = useState<Place[]>(loadPlaces);
  const [loc, setLoc] = useState<Loc | null>(() => {
    if (demo) return DEMO;
    const last = loadLastLocation();
    return last ? { ...last, source: 'last' } : null;
  });
  const [locStatus, setLocStatus] = useState<LocStatus>('idle');
  const [curated, setCurated] = useState<Spot[] | null>(null);
  const [osm, setOsm] = useState<Spot[]>([]);
  const [wind, setWind] = useState<Record<string, SpotWind>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number>(0);
  const [view, setView] = useState<View>('spots');
  const [openId, setOpenId] = useState<string | null>(params.get('spot'));
  const [online, setOnline] = useState(navigator.onLine);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(() => ('Notification' in window ? Notification.permission : 'unsupported'));
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
        saveLastLocation(l);
        setLoc(l);
        setLocStatus('ok');
      },
      (e) => setLocStatus(e.code === e.PERMISSION_DENIED ? 'denied' : 'error'),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  }, []);

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

  const allSpots = useMemo(() => (curated ? [...curated, ...osm] : null), [curated, osm]);

  // Augment with OpenStreetMap spots around the current location.
  useEffect(() => {
    if (!loc || !curated || demo) return;
    let cancelled = false;
    augmentWithOsm(loc, settings.radiusKm, curated)
      .then((extra) => {
        if (!cancelled) setOsm(extra);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loc?.lat, loc?.lon, settings.radiusKm, curated, demo]);

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
    return out;
  }, [allSpots, loc, places, settings.radiusKm]);

  // Spots inside the radius are watched for alerts; fallback (nearest, outside radius) are only shown.
  const [watched, shownOnly] = useMemo(() => {
    const w = new Map<string, Spot>();
    const f = new Map<string, Spot>();
    for (const g of groups) for (const n of g.items) (g.fallback ? f : w).set(n.spot.id, n.spot);
    for (const id of w.keys()) f.delete(id);
    return [[...w.values()], [...f.values()]];
  }, [groups]);
  const watchKey = [...watched, ...shownOnly].map((s) => s.id).join('|');

  const refresh = useCallback(async () => {
    if (watched.length === 0 && shownOnly.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      await kvSet(K.settings, settings);
      await kvSet(K.watch, watched);
      const granted = 'Notification' in window && Notification.permission === 'granted';
      const [{ alerts, wind: w }, extra] = await Promise.all([
        runCheck({ spots: watched, settings, deliver: granted }),
        shownOnly.length ? fetchWind(shownOnly) : Promise.resolve([]),
      ]);
      extra.forEach((x, i) => {
        if (x) w[shownOnly[i].id] = x;
      });
      if (Object.keys(w).length === 0) throw new Error('no data');
      setWind((prev) => ({ ...prev, ...w }));
      setFetchedAt(Date.now());
      for (const a of alerts) await showLocalNotification(a.title, notificationOptions(a));
      // Keep background paths (periodic sync, push subscription) in sync with the watched spots.
      if (granted) enableBackground({ settings, watched, loc, prompt: false }).catch(() => undefined);
    } catch {
      setError(online ? 'Could not fetch wind data. Pull to retry.' : 'Offline — showing the last wind data.');
      const last = await kvGet<Record<string, SpotWind>>(K.lastWind).catch(() => undefined);
      if (last) setWind((prev) => ({ ...last, ...prev }));
    } finally {
      setLoading(false);
    }
  }, [watchKey, settings, online]);

  // Fetch whenever the watched set or settings change.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-check on resume (the main alert path on iOS).
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const fetchedRef = useRef(fetchedAt);
  fetchedRef.current = fetchedAt;
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - fetchedRef.current > STALE_MS) refreshRef.current();
    };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(onVis, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, []);

  const enableAlerts = async () => {
    const r = await requestAlerts({ settings, watched, loc });
    setNotifPerm(r.perm);
    if (r.perm !== 'granted') return;
    // Confirm right away, listing spots that are already on.
    const on = watched
      .map((spot) => ({ spot, w: wind[spot.id] }))
      .filter(({ spot, w }) => w && scoreWind(w.current, spot.sectors, settings).rating === 'good');
    const body = on.length
      ? on
          .slice(0, 3)
          .map(({ spot, w }) => `${spot.name} ${formatSpeed(w!.current.speedKn, settings.unit)}`)
          .join(' · ')
      : `Watching ${watched.length} spots. You will get a notification when one turns good.`;
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
  const showBanner = !demo && !bannerDismissed && notifPerm === 'default' && watched.length > 0 && !(platform.ios && !platform.standalone);

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };
  const updatePlaces = (p: Place[]) => {
    setPlaces(p);
    savePlaces(p);
  };

  // Oldest sample among watched spots, if any is stale (e.g. served from the offline cache).
  const staleAt = (() => {
    const ws = [...watched, ...shownOnly].map((s) => wind[s.id]).filter(Boolean) as SpotWind[];
    const stale = ws.filter((w) => isStale(w));
    return stale.length ? Math.min(...stale.map((w) => w.observedAt || w.fetchedAt)) : 0;
  })();

  const sortItems = (items: NearbySpot[]) =>
    [...items].sort((a, b) => {
      const wa = wind[a.spot.id];
      const wb = wind[b.spot.id];
      const sa = wa ? scoreWind(wa.current, a.spot.sectors, settings).score : -1;
      const sb = wb ? scoreWind(wb.current, b.spot.sectors, settings).score : -1;
      return sb - sa || a.distanceKm - b.distanceKm;
    });

  return (
    <div class="shell">
      <header class="top">
        <a class="brand" href={__BASE__} aria-label="gust home">
          gust
        </a>
        <span class="status" aria-live="polite">
          {loading ? 'Updating…' : fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          {!online && ' · offline'}
        </span>
        <button class="icon-btn" onClick={() => refresh()} disabled={loading || watched.length + shownOnly.length === 0} aria-label="Refresh wind">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </header>

      <main id="main">
        {view === 'spots' && (
          <>
            <LocationBar loc={loc} status={locStatus} onLocate={locate} demo={demo} />
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
            {!allSpots && !error && <p class="muted">Loading spots…</p>}
            {allSpots && groups.length === 0 && (
              <div class="empty">
                <p>Share your location to see kite spots near you, or add a place you ride.</p>
                <button class="btn" onClick={() => setView('places')}>
                  Add a place
                </button>
              </div>
            )}
            {groups.length > 0 && !fetchedAt && !error && (
              <ul class="spots skeleton" aria-label={`Checking wind at ${watched.length + shownOnly.length} spots`}>
                {[...watched, ...shownOnly].slice(0, 6).map((sp) => (
                  <li key={sp.id} class="spot">
                    <div class="spot-head">
                      <span class="spot-main">
                        <span class="spot-name">{sp.name}</span>
                        <span class="spot-sub muted small">Checking wind…</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {(fetchedAt > 0 || error) && groups.map((g) => (
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
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
        {view === 'places' && <PlacesPanel places={places} onChange={updatePlaces} loc={loc} />}
        {view === 'alerts' && <AlertsPanel platform={platform} settings={settings} onSettings={updateSettings} watched={watched} loc={loc} />}
        {view === 'settings' && <SettingsPanel settings={settings} onChange={updateSettings} />}
      </main>

      <nav class="tabs" aria-label="Sections">
        {(
          [
            ['spots', 'Spots'],
            ['places', 'Places'],
            ['alerts', 'Alerts'],
            ['settings', 'Settings'],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button key={v} class={view === v ? 'tab active' : 'tab'} aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
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
