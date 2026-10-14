import { useEffect, useState } from 'preact/hooks';
import type { Platform } from '../lib/platform';
import type { Settings, Spot } from '../lib/types';
import type { LatLon } from '../lib/geo';
import { enableBackground, pushConfigured, type BackgroundStatus } from './background';

interface Props {
  platform: Platform;
  settings: Settings;
  onSettings: (s: Settings) => void;
  watched: Spot[];
  loc: LatLon | null;
}

type Perm = NotificationPermission | 'unsupported';

export function AlertsPanel({ platform, settings, watched, loc }: Props) {
  const [perm, setPerm] = useState<Perm>(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const [bg, setBg] = useState<BackgroundStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Show what is already active when the panel opens (no prompts).
  useEffect(() => {
    let cancelled = false;
    if (perm === 'granted') {
      enableBackground({ settings, watched, loc, prompt: false }).then((s) => {
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
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== 'granted') {
        setMsg('Notifications were not allowed. You can change this in your browser or system settings.');
        return;
      }
      setBg(await enableBackground({ settings, watched, loc, prompt: true }));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    const reg = await navigator.serviceWorker?.getRegistration(__BASE__);
    const opts = { body: 'Notifications work. You will hear from gust when the wind is on.', icon: __BASE__ + 'icons/icon-192.png', tag: 'gust-test' };
    if (reg) await reg.showNotification('gust', opts);
    else new Notification('gust', opts);
  };

  const iosNeedsInstall = platform.ios && !platform.standalone;

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
      <p class="small muted">Watching {watched.length} spots.</p>
    </section>
  );
}
