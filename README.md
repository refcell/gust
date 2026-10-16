# gust

[![CI](https://github.com/refcell/gust/actions/workflows/ci.yml/badge.svg)](https://github.com/refcell/gust/actions/workflows/ci.yml)
[![Pages](https://img.shields.io/github/deployments/refcell/gust/github-pages?label=pages)](https://refcell.github.io/gust/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Wind alerts for kiteboarding spots near you, installable straight from the web.

https://github.com/refcell/gust/raw/main/assets/demo.mp4

<p align="center"><img src="assets/demo.gif" alt="gust demo: nearby spots scored from live wind, hourly forecast, settings, alerts" width="300"></p>

## Install

Open **https://refcell.github.io/gust/** on your phone.

- **iPhone (iOS 16.4+):** open it in Safari, tap **Install gust**, then follow the sheet: Share, Add to Home Screen, Add. Open gust from the Home Screen and allow location and notifications. Chrome and Edge on iOS 16.4+ can also add to the Home Screen from their share menu. In-app browsers (Instagram, Facebook, TikTok, ...) cannot install; open the page in Safari.
- **Android:** open it in Chrome and tap **Install gust** (or Install app from the browser menu). An APK for sideloading is attached to the [apk-latest release](https://github.com/refcell/gust/releases/tag/apk-latest) ([direct download](https://github.com/refcell/gust/releases/download/apk-latest/app-release-signed.apk)).
- **Desktop:** the landing page shows a QR code that opens the site on your phone. Chrome and Edge can also install it as a desktop app.

No App Store and no account. Settings and saved places stay on the device.

## How it works

1. **Spots.** gust finds kite spots within your search radius (default 50 km) of your current location and of each saved place. It starts from a curated dataset of 801 spots (about 320 in the US, 88 countries) in [`data/spots.json`](data/spots.json), with depth across the US (CA, OR, WA, HI, TX, NC, FL, MA, the Great Lakes, and more), and adds spots tagged `sport=kitesurfing` on OpenStreetMap through the Overpass API.
2. **Wind.** For every nearby spot it fetches current and hourly `wind_speed_10m`, `wind_gusts_10m` and `wind_direction_10m` from Open-Meteo in one batched request.
3. **Score.** Each spot has rideable direction sectors: the directions that blow onshore, side-onshore or side-shore at that beach. A reading is **Good** when speed is inside your window (default 15–30 kn), gusts are at or below your limit (default 35 kn), and the direction is inside a rideable sector. Wind more than 15° outside every rideable sector is **Offshore**, scores 0, and is never good. Within 15° is marginal and capped at **OK**. Spots with unknown sectors are scored on speed alone and labelled "direction unknown". Scoring lives in [`src/lib/score.ts`](src/lib/score.ts).
4. **Forecast.** Runs of consecutive good hours (default 2 h or longer) in the hourly forecast become "good windows". Cards show "Good until 18:00" or "Next good: Tomorrow 11:00, 4h", and the detail view has a 48-hour chart.
5. **Alerts.** When a watched spot crosses into Good, or a good window starts within the next 24 hours, gust shows a notification. Watched spots are the listed nearby spots plus your favourites.

The app has four tabs: Spots, Places, Alerts, Settings.

- **First run.** With no location and no saved place, the Spots tab shows a Welcome card: Share location, Enable alerts, or add a place.
- **List and map.** Spots show as a list or on a map (the toggle is remembered). The map uses OpenStreetMap raster tiles, loads on demand, and groups nearby markers into clusters coloured by the best rating in the group. Tap a cluster to zoom in.
- **Favourites and mute.** Open a spot to mark it as a favourite or mute it. Favourites are listed first and stay watched outside the search radius. The Places search also finds curated spots by name, so you can favourite a spot anywhere (for example before a trip). Muted spots never notify and are not sent to the push server.
- **Spot details.** Expanding a spot shows the 48-hour chart and, for coastal spots, marine conditions (see Data sources).
- **Offline.** The service worker caches the app shell, the last wind data and map tiles, so the app opens offline after the first load. Wind older than 90 minutes is marked as cached and is never used for alerts. If the wind service fails, the app retries after a minute.
- **Accessibility.** The tab bar is an ARIA tablist (arrow keys, Home, End). Spot cards are buttons with `aria-expanded`, map markers are buttons with full labels, and the chart has a table alternative. An axe check in the e2e suite fails on serious or critical WCAG 2.1 A/AA issues in light and dark themes.

## Alerts and platform limits

Web apps get fewer background privileges than native apps. gust uses every path each platform allows and tells you in the Alerts tab which ones are active.

| | iPhone (installed PWA) | Android Chrome (installed) | Desktop Chrome/Edge |
|---|---|---|---|
| Check when you open or return to the app | yes | yes | yes |
| Local notification when a spot turns good | yes (iOS 16.4+, installed only) | yes | yes |
| Background checks without a server | no (WebKit has no Periodic Background Sync) | yes, Periodic Background Sync, at the browser's discretion (typically a few times a day) | yes, Periodic Background Sync if installed |
| Background checks with the push server | yes, Web Push (iOS 16.4+) | yes, Web Push | yes, Web Push |
| Background checks with ntfy + GitHub Actions (no account) | yes, ntfy app | yes, ntfy app | yes, ntfy web or desktop |
| Location in the background | no | no | no |
| Calendar reminders for forecast windows (.ics export) | yes, Calendar alarms fire in the background (installed-app handoff to Calendar not yet verified on a device) | yes | yes |

- Notifications on iOS only work after installing to the Home Screen and are requested from a button tap, as WebKit requires.
- Phones never give web apps location in the background. Background checks use the last location gust saw while open, plus your saved places. Save the places you ride.
- The push server is optional and self-hosted (see below). The public build enables Web Push only when it is built with `VITE_PUSH_API` set. Without it, iPhone alerts happen when you open the app.
- In-app checks run when the app opens, when it returns to the foreground, and every minute while it is visible, if the data is older than 10 minutes.
- The push server watches at most 60 spots per device: favourites first, then the nearest. The Alerts tab says when background alerts cover fewer spots than the app does. It sends at most 3 notifications per device per run (with more alerts: 2 plus one summary of the rest) and none during quiet hours (22:00–06:00 in the device's time zone).
- No-account background alerts: ntfy + a scheduled GitHub Actions workflow, works on iPhone and Android (see below).
- No-account background fallback: Alerts → "Add good windows to calendar" exports the next 48 h of good windows at watched spots as an `.ics` file with a reminder 60 minutes before each window. Calendar reminders fire in the background on every platform. It is a forecast snapshot: re-export to refresh (events with the same spot and start time update in place where the calendar supports it).

### Background alerts with ntfy (no account)

A scheduled GitHub Actions workflow (`.github/workflows/ntfy-alerts.yml`, every 15 minutes) runs `scripts/ntfy-alerts.ts`: it resolves the watched spots from a config like the app does (spots within the radius of each place plus favourites, muted ones dropped, at most 60, favourites first), fetches Open-Meteo, scores with the same `src/lib/alerts.ts` code, and publishes new alerts to an [ntfy](https://ntfy.sh) topic. Same rules as the push server: no alert for a spot that is already good on the first run, at most 3 notifications per run (with more alerts: 2 plus one summary), quiet hours 22:00–06:00 in the config's time zone (`quietHours`, `""` disables), and failed publishes are rolled back and retried on the next run.

1. Install the ntfy app (iOS or Android) and, in gust, open Alerts → "Background alerts with ntfy". Tap "Generate topic" and subscribe to that topic on `ntfy.sh` in the ntfy app. Anyone who knows the topic can read and post to it, so keep it private (it is stored only in this browser).
2. Tap "Copy alert config". It holds your saved places (or, without any, your last location rounded to ~100 m), favourites and wind settings, not the topic.
3. In the repository (`refcell/gust` for the owner, or your fork) go to Settings → Secrets and variables → Actions. Add two secrets: `NTFY_TOPIC` (the topic) and `GUST_ALERTS_CONFIG` (the config; a secret because job environment values appear in public run logs, and it holds your places). Optional: variable `NTFY_SERVER` for a self-hosted ntfy server. In a fork, enable workflows on the Actions tab.
4. Run the "ntfy alerts" workflow once from the Actions tab (Run workflow) to check the setup.

Without the secret or the variable the workflow exits successfully with a notice. Limits: GitHub can delay scheduled runs by several minutes (more at busy times), and disables schedules in public repositories after 60 days without activity. Dedup state (`.gust-ntfy/state.json`) is kept with `actions/cache` (restored by prefix, saved under a new key each run); if the cache is evicted (7 days unused), the next run behaves like a first run. Copy the config again after changing places, favourites or settings. Favourites that are only in OpenStreetMap (not `data/spots.json`) are skipped.

## Data sources

- **Wind:** [Open-Meteo](https://open-meteo.com/) forecast API (CC BY 4.0). No key; the free tier allows fewer than 10,000 calls per day for non-commercial use. gust batches up to 50 spots per request, re-checks only when data is older than 10 minutes, and retries a minute after a failure. Limits are per IP and weighted by the number of locations.
- **Waves, water temperature, tide:** [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api) (`marine-api.open-meteo.com`, no key), fetched only when you open a spot and cached for an hour. Tide is modelled sea level at hourly resolution, not a tide-station prediction; the wetsuit hint is a rough guide. Inland spots show none of this.
- **Spots:** the curated [`data/spots.json`](data/spots.json) (schema in [`data/README.md`](data/README.md)), plus [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass. Overpass is shared infrastructure, so OSM lookups are cached in `localStorage` per 0.5° tile and radius bucket for 14 days, failures for 1 hour, and capped at 6 calls per device per day. For OSM spots without known sectors, gust infers the shore orientation from nearby `natural=coastline` ways (land on the left, water on the right) and treats ±90° around the seaward normal (side-shore at most) as rideable. Lake shores and islands inside lakes are handled; river banks stay "unknown".
- **Place search:** Open-Meteo geocoding API.
- **Map tiles:** OpenStreetMap standard tiles (`tile.openstreetmap.org`), with attribution. The service worker keeps up to 200 tiles and honours their cache headers (7 days when there are none).

## Configuration

In the app (Settings tab):

| Setting | Default |
|---|---|
| Units | kn (also mph, m/s, km/h) |
| Wind window | 15–30 kn |
| Max gust | 35 kn |
| Search radius | 50 km (5–300 km) |
| Forecast alerts | on |
| Minimum window length | 2 h (1–12 h) |

Per spot: Favourite and Mute alerts (in the expanded card). Everything is stored in `localStorage` on the device.

Build-time environment variables:

| Variable | Purpose |
|---|---|
| `VITE_PUSH_API` | Base URL of the push backend, e.g. `https://gust-push.example.workers.dev`. Enables Web Push. |
| `VITE_VAPID_PUBLIC_KEY` | VAPID public key (base64url) that matches the backend. |

CI reads both from repository variables (`gh variable set VITE_PUSH_API --body ...`).

Add `?demo=1` to the app URL to use a fixed location in San Francisco with live wind. The landing page demo uses it (it shows a still poster until the phone frame scrolls into view). `?spot=<id>` opens the app scrolled to that spot; notifications use it.

## Development

Requires Node 22+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev               # http://localhost:5173/gust/ (app at /gust/app/)
pnpm test              # unit tests (vitest), including the server tests
pnpm typecheck
pnpm lint
pnpm build             # dist/, including dist/sw.js
pnpm preview           # serve dist/ at http://localhost:4173/gust/
pnpm exec playwright install chromium webkit
pnpm e2e               # Playwright against `vite preview` (mocked geolocation and network)
pnpm typecheck:server  # typecheck server/
```

`pnpm e2e` runs four projects: `mobile` (Pixel 7), `desktop`, `iphone` (WebKit, iPhone 15) and `pwa` (service worker enabled: install, precache, offline). Set `PW_PORT` to use a port other than 4173. If pnpm refuses to run in a git worktree with a symlinked `node_modules`, call the binaries directly, e.g. `./node_modules/.bin/vitest run`.

Scripts (run with `node scripts/<name>.mjs`):

| Script | Purpose |
|---|---|
| `verify-live.mjs [url]` | Smoke-test a deploy with real data: service worker, installability, offline reload. Defaults to the live site. |
| `record-demo.mjs` | Re-record `assets/demo.mp4` and `assets/demo.gif`. Run `pnpm build` first; needs ffmpeg (`FFMPEG` overrides the path). |
| `poster.mjs` | Render the landing-page demo posters (light and dark). Run `pnpm build` first. |
| `icons.mjs` | Regenerate the icon set from SVG (also `pnpm icons`). |
| `merge-spots.mjs [--keep]` | Validate `data/new-*.json`, drop duplicates (same id or within 1.5 km) and append to `data/spots.json`. |
| `check-spots.mjs [maxMeters]` | Flag curated coastal spots above `maxMeters` (default 25) using Open-Meteo elevation. |
| `infer-sectors.ts [--apply]` | Run as `node --import ./scripts/ts-resolve.mjs scripts/infer-sectors.ts` (Node 22.15+). Without flags: one Overpass query per spot with `sectors: []`, writing `data/sector-suggestions.json` for review (saved per spot, resumes). `--apply`: copy entries marked `"review": "approved"` into `data/spots.json`. |
| `snap-spots.mjs id ...` | Move the given spots to the nearest low-lying cell next to the sea. Expensive: 1–3 spots at a time. |
| `lh-summary.mjs report.json ...` | Print a Markdown summary of Lighthouse JSON reports. |

`check-spots` and `snap-spots` use the Open-Meteo per-IP budget; running them can make the app on the same network fail for a minute.

Layout:

```
index.html, src/landing/   landing page (install button, iOS sheet, QR code)
app/index.html, src/app/   the PWA (Preact)
src/lib/                   pure logic: scoring, sectors, units, geo, forecast, alerts, Open-Meteo client
src/sw/sw.ts               service worker: offline shell, data cache, periodic sync, push
data/spots.json            curated spots
server/                    optional Web Push backend (Cloudflare Worker)
android/                   TWA wrapper for the APK
```

Workflows (`.github/workflows/`):

| Workflow | Runs | Does |
|---|---|---|
| CI (`ci.yml`) | every push to `main`, pull requests | typecheck, lint, unit tests, build, e2e (Chromium and WebKit), then deploys `dist/` to GitHub Pages from `main` |
| Lighthouse (`lighthouse.yml`) | after a successful CI run on `main` | report-only mobile Lighthouse run against the live landing page and `app/?demo=1` |
| Android APK (`android.yml`) | changes under `android/`, `v*` tags, manual | builds the signed TWA APK and publishes it to the `apk-latest` prerelease (or a tag release) |
| Spot coordinate check (`spots-check.yml`) | weekly, manual | `check-spots.mjs 15`, report only |
| Infer spot sectors (`infer-sectors.yml`) | manual | `infer-sectors.ts` from the runner's IP, uploads the suggestions artifact, never commits |

## Self-hosting the push backend

`server/` is a Cloudflare Worker with KV and a cron trigger. It stores push subscriptions with each subscriber's watched spots and settings, checks the wind every 30 minutes with the same scoring code as the app, and sends Web Push (VAPID) notifications. See [`server/README.md`](server/README.md) for the full steps. In short:

```sh
cd server && pnpm install
npx wrangler login
npx wrangler kv namespace create SUBS     # paste the id into wrangler.toml
node scripts/gen-vapid.mjs                # prints the secret commands and the public key
pnpm run deploy
gh variable set VITE_PUSH_API --body https://<your-worker>.workers.dev
gh variable set VITE_VAPID_PUBLIC_KEY --body <public key>
```

The next CI run builds the app with push enabled. `/subscribe` is unauthenticated (a browser cannot hold a secret), so add a Cloudflare rate-limiting rule for it before going public.

## License

[MIT](LICENSE)
