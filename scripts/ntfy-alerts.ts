/**
 * No-account background alerts via ntfy (see README "Background alerts with ntfy").
 *
 *   GUST_ALERTS_CONFIG='{"places":[...]}' NTFY_TOPIC=<topic> \
 *     node --import ./scripts/ts-resolve.mjs scripts/ntfy-alerts.ts
 *
 * Env: GUST_ALERTS_CONFIG (JSON, from the app's "Copy alert config"), NTFY_TOPIC (secret),
 * NTFY_SERVER (optional, default https://ntfy.sh), GUST_STATE_FILE (optional, default
 * .gust-ntfy/state.json; the workflow persists it with actions/cache).
 *
 * Exit codes: 0 when done (also when unconfigured: nothing to do), 1 for an invalid config.
 * Failed publishes only warn: their alerts are rolled back in the state and retried next run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseAlertsConfig, validTopic } from '../src/lib/ntfy';
import type { Spot } from '../src/lib/types';
import { parseState, runNtfyAlerts, validServer } from './ntfy';

const stateFile = process.env.GUST_STATE_FILE || '.gust-ntfy/state.json';
const topic = (process.env.NTFY_TOPIC ?? '').trim();
const rawConfig = process.env.GUST_ALERTS_CONFIG ?? '';

if (!topic || !rawConfig.trim()) {
  console.log('::notice::ntfy alerts not configured (set secrets NTFY_TOPIC and GUST_ALERTS_CONFIG). Nothing to do.');
  process.exit(0);
}
if (!validTopic(topic)) {
  console.log('::error::NTFY_TOPIC must be 1-64 letters, digits, "_" or "-".');
  process.exit(1);
}
/** NTFY_SERVER, validated before the topic is ever appended (so errors cannot echo it). */
function serverArg(): string | undefined {
  const raw = process.env.NTFY_SERVER?.trim();
  if (!raw) return undefined;
  const ok = validServer(raw);
  if (!ok) {
    console.log('::error::NTFY_SERVER must be an http(s) URL, e.g. https://ntfy.example.com');
    process.exit(1);
  }
  return ok;
}
const parsed = parseAlertsConfig(rawConfig);
if (!parsed.ok) {
  console.log(`::error::GUST_ALERTS_CONFIG: ${parsed.error}`);
  process.exit(1);
}

const allSpots = JSON.parse(readFileSync('data/spots.json', 'utf8')) as Spot[];
const state = parseState(existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : null);
if (!state) console.log('No previous state: first run. Spots that are already good do not alert; changes from now on do.');

const report = await runNtfyAlerts({
  config: parsed.config,
  state,
  allSpots,
  topic,
  server: serverArg(),
  log: (m) => console.log(`::warning::${m}`),
});

if (report.missingFavorites.length) console.log(`::warning::Favourites not in data/spots.json (skipped): ${report.missingFavorites.join(', ')}`);
if (report.quiet) {
  console.log(`Quiet hours (${parsed.config.quietHours} ${parsed.config.timezone}): skipped, state unchanged.`);
} else {
  console.log(`Watching ${report.watched} of ${report.total} spots; wind for ${report.withWind}; ${report.alerts.length} alerts; ${report.sent} published, ${report.failed} failed.`);
  if (report.watched > 0 && report.withWind === 0) console.log('::warning::No wind data (Open-Meteo unreachable?); state unchanged.');
}
if (report.state) {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(report.state));
}
