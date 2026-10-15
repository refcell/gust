import { useState } from 'preact/hooks';
import type { LatLon } from '../lib/geo';
import { buildAlertsConfig, randomTopic, validTopic } from '../lib/ntfy';
import type { Place, Settings } from '../lib/types';

const TOPIC_KEY = 'gust.ntfyTopic';
const REPO_URL = 'https://github.com/refcell/gust';

function loadTopic(): string {
  try {
    const t = localStorage.getItem(TOPIC_KEY) ?? '';
    return validTopic(t) ? t : '';
  } catch {
    return '';
  }
}

interface Props {
  settings: Settings;
  places: Place[];
  loc: LatLon | null;
}

/** Setup guide for the no-account background alerts (ntfy + scheduled GitHub Actions workflow). */
export function NtfySection({ settings, places, loc }: Props) {
  const [topic, setTopic] = useState(loadTopic);
  const [msg, setMsg] = useState<string | null>(null);
  // Text to copy by hand when the clipboard is unavailable.
  const [manual, setManual] = useState<string | null>(null);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setManual(null);
      setMsg(`${what} copied.`);
    } catch {
      setManual(text);
      setMsg(`Could not copy automatically. Select the ${what.toLowerCase()} below and copy it.`);
    }
  };

  const generate = () => {
    const t = randomTopic();
    setTopic(t);
    setManual(null);
    setMsg('New topic generated. Subscribe to it in ntfy and update the NTFY_TOPIC secret.');
    try {
      localStorage.setItem(TOPIC_KEY, t);
    } catch {
      /* storage unavailable: the topic still shows for this session */
    }
  };

  const copyConfig = () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const config = buildAlertsConfig({ places, settings, loc, timezone: tz });
    void copy(JSON.stringify(config), 'Alert config');
  };

  const nothingWatched = places.length === 0 && !loc && !(settings.favorites?.length);

  return (
    <details class="ntfy">
      <summary>Background alerts with ntfy</summary>
      <p class="small">
        Works on iPhone and Android without an account or a server: a scheduled GitHub Actions workflow checks your saved places and favourites every 15 minutes and sends new alerts to the free{' '}
        <a href="https://ntfy.sh" target="_blank" rel="noopener">
          ntfy
        </a>{' '}
        app. GitHub can delay scheduled runs by several minutes, so alerts may arrive late; nothing is sent during quiet hours (22:00-06:00), and GitHub pauses schedules in a public repo after 60 days without commits.
      </p>
      <ol class="caps small">
        <li>Install the ntfy app (App Store or Google Play).</li>
        <li>
          Generate a long random topic and subscribe to it in ntfy (server ntfy.sh). Anyone who knows the topic can read your alerts, so keep it private.
          <div class="ntfy-row">
            <button class="btn ghost small" onClick={generate}>
              {topic ? 'Generate new topic' : 'Generate topic'}
            </button>
            {topic && (
              <button class="btn ghost small" onClick={() => void copy(topic, 'Topic')}>
                Copy topic
              </button>
            )}
          </div>
          {topic && (
            <p>
              Topic: <code class="ntfy-topic">{topic}</code>
            </p>
          )}
        </li>
        <li>
          Copy the alert config. It contains your saved places{places.length ? '' : ' (or your last location)'}, favourites and wind settings, not the topic.
          <div class="ntfy-row">
            <button class="btn ghost small" onClick={copyConfig} disabled={nothingWatched}>
              Copy alert config
            </button>
          </div>
        </li>
        <li>
          One-time setup in{' '}
          <a href={REPO_URL} target="_blank" rel="noopener">
            refcell/gust
          </a>{' '}
          (owner) or your fork of it: Settings, Secrets and variables, Actions. Add two secrets: <code>NTFY_TOPIC</code> with the topic and <code>GUST_ALERTS_CONFIG</code> with the config (a secret keeps your places out of the public run logs). In a fork, enable workflows on the Actions tab. Copy the config again after changing places or settings.
        </li>
      </ol>
      {msg && (
        <p class="small" role="status">
          {msg}
        </p>
      )}
      {manual !== null && <textarea class="ntfy-manual" readOnly rows={4} aria-label="Text to copy" value={manual} onFocus={(e) => e.currentTarget.select()} />}
    </details>
  );
}
