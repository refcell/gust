import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Platform } from '../lib/platform';
import type { Place, Settings, Spot, SpotWind } from '../lib/types';
import type { LatLon } from '../lib/geo';
import { pushSpots } from '../lib/pushsync';
import { buildIcs, calendarWindows, nextSequence } from '../lib/ics';
import { saveFile } from './download';
import { NtfySection } from './NtfySection';
import { enableBackground, pushConfigured, requestAlerts, showLocalNotification, type BackgroundStatus } from './background';

interface Props {
  platform: Platform;
  settings: Settings;
  watched: Spot[];
  loc: LatLon | null;
  /** Last location and saved places (which spots the push server watches). */
  origins: LatLon[];
  /** Saved places (for the ntfy alert config). */
  places: Place[];
  /** Latest wind per spot id (for the calendar export). */
  wind: Readonly<Record<string, SpotWind>>;
}

type Perm = NotificationPermission | 'unsupported';

export function AlertsPanel({ platform, settings, watched, loc, origins, places, wind }: Props) {
  const [perm, setPerm] = useState<Perm>(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const [bg, setBg] = useState<BackgroundStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Show what is already active when the panel opens (no prompts).
  useEffect(() => {
    let cancelled = false;
    if (perm === 'granted') {
      enableBackground({ settings, watched, loc, origins, prompt: false }).then((s) => {
        if (!cancelled) setBg(s);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [perm]);

  const enable = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await requestAlerts({ settings, watched, loc, origins });
      setPerm(r.perm);
      if (r.perm !== 'granted') {
        setMsg('Notifications were not allowed. You can change this in your browser or system settings.');
        return;
      }
      setBg(r.status);
    } finally {
      setBusy(false);
    }
  };

  const test = () =>
    showLocalNotification('gust', { body: 'Notifications work. You will hear from gust when the wind is on.', icon: __BASE__ + 'icons/icon-192.png', tag: 'gust-test' });

  // Upcoming good windows (next 48 h) at watched, non-muted spots for the calendar export.
  const calWins = useMemo(() => calendarWindows(watched.map((spot) => ({ spot, wind: wind[spot.id] })), settings, Date.now()), [watched, wind, settings]);
  const exportCalendar = () => {
    const now = Date.now();
    // Recompute at click time so windows that ended since render are dropped.
    const wins = calendarWindows(watched.map((spot) => ({ spot, wind: wind[spot.id] })), settings, now);
    if (!wins.length) return;
    // Storage only improves SEQUENCE ordering across exports; it must never block the export.
    let prev: number | null = null;
    try {
      prev = Number(localStorage.getItem('gust.icsSeq'));
    } catch {
      /* storage unavailable */
    }
    const sequence = nextSequence(prev, now);
    try {
      localStorage.setItem('gust.icsSeq', String(sequence));
    } catch {
      /* quota or denied: export anyway */
    }
    saveFile(buildIcs(wins, { now, unit: settings.unit, sequence }), 'gust-windows.ics', 'text/calendar;charset=utf-8', { iosStandalone: platform.ios && platform.standalone });
  };

  const iosNeedsInstall = platform.ios && !platform.standalone;
  // The push server watches at most MAX_PUSH_SPOTS spots; say so when some are left out.
  const cover = pushSpots(watched, settings, origins);
  const capped = pushConfigured && cover.spots.length < cover.total;

  return (
    <section class="panel" aria-labelledby="alerts-h">
      <h2 id="alerts-h">Alerts</h2>
      {perm === 'unsupported' || iosNeedsInstall ? (
        <p>
          {iosNeedsInstall
            ? 'On iPhone, notifications only work after you install gust: tap Share, then Add to Home Screen, then open gust from your home screen.'
            : 'This browser does not support notifications.'}
        </p>
      ) : perm === 'granted' ? (
        <>
          <p>Notifications are on.</p>
          <button class="btn ghost" onClick={test}>
            Send a test notification
          </button>
        </>
      ) : (
        <>
          <p>Get a notification when a spot near you turns good, and when a good window is coming up.</p>
          <button class="btn" onClick={enable} disabled={busy || perm === 'denied'}>
            {perm === 'denied' ? 'Notifications blocked' : 'Enable alerts'}
          </button>
        </>
      )}
      {msg && <p class="notice">{msg}</p>}

      <h3>On this device</h3>
      <ul class="caps small">
        <li>
          <strong>When you open gust:</strong> always. gust checks the wind every time you open or return to the app and notifies you when a spot crosses into good.
        </li>
        <li>
          <strong>In the background:</strong>{' '}
          {bg?.push === 'subscribed'
            ? 'on, through the gust push server. It checks your last known location and saved places.'
            : bg?.periodicSync === 'registered'
              ? 'on, through Periodic Background Sync. Your browser decides how often it runs (usually a few times a day).'
              : platform.ios
                ? pushConfigured
                  ? 'available once alerts are enabled in the installed app.'
                  : 'not available. iOS has no background sync and this build has no push server. Open gust to check.'
                : 'not available in this browser. Install gust and use Chrome on Android for background checks.'}
        </li>
        <li>
          <strong>Location:</strong> background checks use the last location gust saw and your saved places. Phones do not give web apps location in the background.
        </li>
      </ul>
      <NtfySection settings={settings} places={places} loc={loc} />
      <h3>Calendar</h3>
      <button class="btn ghost" onClick={exportCalendar} disabled={calWins.length === 0}>
        {calWins.length ? 'Add good windows to calendar' : 'No good windows in the next 48 h'}
      </button>
      <p class="small muted">
        {calWins.length ? `${calWins.length} ${calWins.length === 1 ? 'window' : 'windows'}. ` : ''}A forecast snapshot with a reminder an hour before each window; re-export to refresh. Calendar reminders fire in the background, even on iPhone.
      </p>

      <p class="small muted">Watching {watched.length} spots.</p>
      {capped && (
        <p class="notice small" role="note">
          Background alerts cover your {cover.spots.length} nearest/favourite spots (of {cover.total} watched); in-app checks cover all.
        </p>
      )}
    </section>
  );
}
