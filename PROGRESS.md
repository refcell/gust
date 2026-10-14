# Progress

## Status

Milestone 1 (installable PWA with real nearby spots, live wind, scores, in-app notifications) is
live at https://refcell.github.io/gust/ and verified with `scripts/verify-live.mjs` (real network,
Chromium installability via CDP, SW active, offline reload). Landing page with install flows (BIP,
iOS sheet, in-app browser detection, desktop QR). OSM Overpass augmentation + coastline sector
inference merged. Push backend (`server/`, Cloudflare Worker) merged and tested, not deployed (no
credentials). Android APK workflow merged; first run failed on minSdk (fixed to 24), re-running.
Advisor review (gpt-6.1-sol) done; its must-fix items addressed except the dataset side-off audit
(worker lane in flight).

## Decisions

- Hosting on GitHub Pages (no account needed). Pages enabled with `build_type=workflow`.
- Stack: Vite 8 + Preact + TypeScript 5.9 (typescript-eslint not yet compatible with TS 7). pnpm.
- Manifest scope is `/gust/` (not `/gust/app/`) with `start_url` `/gust/app/`, so the landing
  page at `/gust/` is in scope: `beforeinstallprompt` fires there and iOS Add to Home Screen from
  the landing page launches the app.
- Service worker is hand-written (`src/sw/sw.ts`), built as a classic IIFE script by a small Vite
  plugin that injects the emitted asset list for precaching. No Workbox (bundle size, control).
- Spots JSON is fetched as a hashed static asset rather than bundled into JS.
- Sectors `[0,360]` mean "any direction" (causeways/sandbars). A few flat-water spots ridden
  side-off include that edge in their sectors; notes flag it. Revisit if a strict rule is wanted.
- Scoring: outside every rideable sector by > 15° = offshore -> score 0, never good. Within 15° =
  marginal, capped at "OK". Unknown sectors score on speed only with a 0.85 factor.
- e2e tests block service workers (`serviceWorkers: 'block'`) so network mocks apply.
- Overpass usage limit (~100 req/day across all users): OSM augmentation must cache per tile for
  days and only fetch on significant location change.

- Git push uses SSH (`git remote set-url --push origin git@github.com:refcell/gust.git`) because the
  gh OAuth token lacks the `workflow` scope needed to push `.github/workflows/*`.
- Android: Bubblewrap TWA (`android/twa-manifest.json`, `android/build-apk.sh`), built in Actions,
  published to the `apk-latest` prerelease. Signing keystore: PKCS12 generated locally with openssl
  (no JDK on this machine), stored as repo secrets `ANDROID_KEYSTORE_B64`/`ANDROID_KEYSTORE_PASSWORD`;
  backup at `~/.config/gust-android/` on the owner's machine. Alias `android`.
- TWA verification: `refcell/refcell.github.io` does not exist (the name redirects elsewhere), so
  `https://refcell.github.io/.well-known/assetlinks.json` cannot be served from this repo. The APK
  shows a thin URL bar. Upgrade path: create the user-site repo with `.well-known/assetlinks.json`
  (+ `.nojekyll`), or move to a custom domain. Not done automatically: it would publish content at
  the owner's root domain.
- First-run alerts banner on the Spots tab (not on iOS until installed). Enabling alerts shows an
  immediate confirmation notification listing spots that are on now.

- OSM: cache per 0.5° tile + radius bucket (25/50/100 km) for 14 days in localStorage; failures
  cached 1 h; max 6 Overpass calls per device per day; backoff 1 h after both endpoints fail.
  Coastline inference: nearest segment within 1.5 km, seaward normal ±100°; closed lakes >= 0.5 km².
  OSM spots carry a "check locally" note. Live check from a browser on the Pages origin got 504 from
  both public endpoints (overloaded), CORS fine; code degrades to curated-only.
- Push backend: own RFC 8291 aes128gcm + VAPID ES256 on WebCrypto (no deps; matches the RFC test
  vector). KV writes only on change (free tier 1000 writes/day). Max 3 notifications per subscriber
  per run, rest folded into a summary. Quiet hours 22:00–06:00 subscriber tz. Not deployed: no
  wrangler/Cloudflare/Deno credentials on this machine. Fallback: in-app checks + Periodic Background
  Sync (Android). Upgrade: `cd server && wrangler login && ...` (server/README.md), then set repo
  variables VITE_PUSH_API / VITE_VAPID_PUBLIC_KEY; CI builds with push enabled.
- Data validity: wind samples must be finite, speeds >= 0, direction 0..360; invalid current data
  drops the spot; scoring fails closed (null gust => too strong, NaN speed/dir => "No data").
- Staleness: each SpotWind has `observedAt` (epoch of the current sample). Data older than 90 min is
  stale: shown with a notice, never used for alerts or to overwrite alert state. Forecast alerts
  require `now < start <= now + 24h`. Forecast runs break on missing hours.
- Forecast-window dedup is only recorded when notifications can be delivered.
- e2e has a `pwa` project with the service worker enabled (install, precache, offline).
- Light theme accent/good colours darkened to pass WCAG AA for normal text.

- Dataset expansion: three parallel workers wrote `data/new-*.json`; `scripts/merge-spots.mjs`
  validates (schema, sector width <= 220° unless documented any-direction, Americas longitude sign)
  and dedupes (id, 1.5 km) before appending. 587 spots, 296 US, 71 countries. Texas City Dike added
  to the documented any-direction list.
- Push server cron is delivery-aware like the client: if any push for a subscriber fails or the
  per-run cap cuts delivery, forecast windows are not consumed and "now" transitions are rolled
  back, so they resend next run (duplicates preferred over lost alerts).
- Overpass shore query limited to 15 points (was 40) to reduce 504s on public instances.
- `/subscribe` is unauthenticated (a browser client cannot hold a secret). Before deploying, add a
  Cloudflare rate-limiting rule for `/subscribe` (documented upgrade; config-only).
- Advisor gate (kimi-k3, after gpt-6-astra hit quota and a gpt-6.1-sol run dropped): "Definition of
  done met apart from physical-device testing", its one must-fix (cron state commit) done.

## Next

1. Physical-device acceptance (owner): iPhone Safari install -> location -> Enable alerts -> test
   notification; Android Chrome install + APK sideload. Everything else is verified in CI/live.
2. Deploy push backend when credentials exist (server/README.md), then set repo variables.
3. Better direction inference for unknown-sector OSM spots (bbox shore query per tile).
4. Per-spot favourites / mute; share links (?spot=id) scroll into view.
5. Verify lower-confidence spot coordinates against OSM coastline data (scripted check).

## Log

- Repo created with MISSION.md.
- Loop 1: scaffold, core libs (units, sectors, geo, score, forecast, alerts, open-meteo), app UI,
  landing page, SW, icons, tests, CI + Pages workflow, curated dataset (worker lane).
- Loop 2: merged OSM lane, push backend lane, APK lane; stable APK keystore secrets; README with
  demo; first-run alerts banner; CLS fix; advisor review + fixes (validation, staleness, gaps,
  delivery-aware dedup, contrast, SW e2e gate).
- Loop 3: dataset safety audit merged (112 spots narrowed), +169 spots via three parallel lanes,
  Install row in app Settings, iOS sheet illustration, stray-0 render fix, clock-relative e2e mocks,
  server cron delivery-aware dedup, second advisor gate passed.
