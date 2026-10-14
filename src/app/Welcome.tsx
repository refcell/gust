import { useState } from 'preact/hooks';

type LocStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'error' | 'unsupported';

interface Props {
  locStatus: LocStatus;
  onLocate: () => void;
  notifPerm: NotificationPermission | 'unsupported';
  onEnableAlerts: () => Promise<void>;
  /** iOS Safari before install: notifications are unavailable, show the install steps instead. */
  iosNeedsInstall: boolean;
  onAddPlace: () => void;
}

const LOC_TEXT: Record<LocStatus, string> = {
  idle: 'See kite spots near you, scored from live wind.',
  locating: 'Finding your location…',
  ok: 'Location shared.',
  denied: 'Location is blocked. Allow it in your browser settings, or add a place.',
  error: 'Could not get your location. Try again, or add a place.',
  unsupported: 'This browser cannot share location. Add a place instead.',
};

/** First-run card: shown when there is no location and no saved place. */
export function Welcome({ locStatus, onLocate, notifPerm, onEnableAlerts, iosNeedsInstall, onAddPlace }: Props) {
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    try {
      await onEnableAlerts();
    } finally {
      setBusy(false);
    }
  };

  let alertText: string;
  if (iosNeedsInstall) alertText = 'On iPhone, alerts need the installed app: tap Share, then Add to Home Screen, then open gust from your home screen.';
  else if (notifPerm === 'unsupported') alertText = 'This browser does not support notifications.';
  else if (notifPerm === 'granted') alertText = 'Alerts are on.';
  else if (notifPerm === 'denied') alertText = 'Notifications are blocked. You can allow them in your browser or system settings.';
  else alertText = 'Get a notification when a spot near you turns good.';
  const canEnable = !iosNeedsInstall && notifPerm === 'default';

  return (
    <section class="welcome" aria-labelledby="welcome-h">
      <h2 id="welcome-h">Welcome to gust</h2>
      <p>gust finds kite spots near you, scores them from live and forecast wind, and tells you when the wind is on.</p>
      <ol class="steps">
        <li>
          <span class="step-text">
            <strong>Share your location</strong>
            <span class="small muted" role="status">
              {LOC_TEXT[locStatus]}
            </span>
          </span>
          {locStatus !== 'unsupported' && (
            <button class="btn" onClick={onLocate} disabled={locStatus === 'locating'}>
              Share location
            </button>
          )}
        </li>
        <li>
          <span class="step-text">
            <strong>Turn on alerts</strong>
            <span class="small muted">{alertText}</span>
          </span>
          {canEnable && (
            <button class="btn ghost" onClick={enable} disabled={busy}>
              Enable alerts
            </button>
          )}
        </li>
      </ol>
      <p class="small">
        <button class="link-btn" onClick={onAddPlace}>
          or add a place
        </button>
      </p>
    </section>
  );
}
