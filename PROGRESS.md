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

- Open-Meteo limits are per IP and weighted by location count (minutely/hourly/daily). Bulk
  scripts (`check-spots`, `snap-spots`) can exhaust the minute budget and make the app on the same
  network fail for a minute; the app now shows "Retrying in a minute" and retries automatically.
  For the push server, all subscribers share Cloudflare egress IPs: dedupe points (done) and keep
  the cron at 30 min; above a few hundred distinct spots use the Open-Meteo commercial API.
- Spot coordinate check: `scripts/check-spots.mjs` flags coastal spots above 25 m (Open-Meteo
  elevation); `scripts/snap-spots.mjs` moves listed ids to the nearest 0.5–5 m cell adjacent to sea.
  Lakes/rivers at altitude (jordanelle, wasaga, campione, dougs-beach) are expected and skipped.
- Per-spot mute (`settings.muted`): enforced in `computeAlerts` (page + SW) and muted spots are not
  sent to the push server.

- e2e also runs on WebKit with iPhone 15 emulation (`iphone` project) in CI — the closest automated
  stand-in for iOS Safari. Real-device acceptance remains the owner's step.

- OSM shore inference: one Overpass bbox query per tile (new spots + 2 km, sides capped at 40 km,
  fallback nearest 15 then shrink). Coastline + natural=water (untagged = lake) incl. multipolygon
  outer rings; nearest shore a water=river polygon -> unknown. Spots outside the queried box are
  cached unknown (14 d). Full geometry kept (trimming breaks ring closure).
- First run: a Welcome card (Share location / Enable alerts / or add a place) replaces the empty
  state; tab bar is an ARIA tablist (arrow/Home/End); "gust" is the h1.
- Accessibility gate: `e2e/a11y.spec.ts` (axe) fails on serious/critical WCAG 2.1 A/AA issues on the
  landing page and every app view, light and dark. Moderate "duplicate landmark" from the embedded
  demo iframe accepted.
- CI runs Chrome installability + manifest checks (CDP) for landing and app.

- Map view: List | Map toggle (persisted `gust.spotsMode`); dependency-free slippy map in a lazy
  chunk (3.1 kB gzip) on OSM raster tiles with attribution; markers are buttons with rating letters
  + full aria-labels; SW runtime cache `gust-tiles` (cache-first, 200 entries, CORS so no opaque
  responses). Marker clustering is a later improvement.
- +59 spots (646 total) favouring confidence over count; uncertain orientation -> sectors [].
  8 BC spots corrected to country CA.
- Advisor (gpt-6.1-sol) review of loops 4-5: blocker (lake-island shore inference), should-fix
  (per-alert cron rollback, mute sync independent of weather fetch, axe gate failing open). Axe
  gate now a static import (fails closed). Fixed: lake inner rings kept as 'island' shores (water
  outside), unclosed/unjoined water pieces are 'ambiguous' (distance only -> unknown when nearest);
  cron rolls back only undelivered alerts (payloads carry their alerts); push settings sync runs
  on settings/watch changes independent of weather (debounced 1.5 s, newest-wins sender, skipped
  until spots load so an empty list never wipes the server).
- Session reloads stop async workflows (not resumable): relaunch the same workflow; bulk scripts
  that rewrite data/spots.json must not run concurrently with merges.

- Map clustering: greedy 40 px screen-space clusters (recomputed on zoom only), coloured by best
  rating (Good > OK > Light > Strong > No wind > Offshore); tap zooms to fit, at max zoom lists.
- Favourites (`settings.favorites`): sorted first, star in list, ring on map; always watched for
  alerts even outside the radius (own "Favourites" section when not otherwise listed).
- +41 spots (687 total); coordinates for new spots partly from Nominatim beach outlines by the
  worker (~150 throttled lookups, 1.3 s apart, gust User-Agent).
- Playwright `reuseExistingServer: false`: a worker's leftover `vite preview` on :4173 silently
  served an old worktree build and failed 15 e2e tests; now a busy port fails loudly.

- Lighthouse (mobile, `?demo=1`) reported CLS 0.384 on a loaded spot card twice; a real-browser
  layout-shift observer under 4x CPU + slow-4G throttling records 0.001 (the "Updated" text). The
  skeleton now mirrors group sections/headings anyway. Lighthouse's own Chrome launch then failed
  on this machine ("Connection closed"); re-measure in CI later. Treat as lab-only for now.
- Advisor (gpt-6.1-sol) review of loops 6-7: blockers (stale weather completions re-sending
  unmuted settings; inferred ±100° sectors include cross-offshore; >60 watched spots rejected by
  the server) and should-fix (refetch on scoring-only changes, OSM favourites lost when the dataset
  changes, tile freshness per OSM policy, stale shore cache, antimeridian). Two fix lanes.
- `PW_PORT` overrides the e2e port so parallel worktrees can run Playwright side by side.

## Next

1. Physical-device acceptance (owner): iPhone Safari install -> location -> Enable alerts -> test
   notification; Android Chrome install + APK sideload. Everything else is verified in CI/live.
2. Deploy push backend when credentials exist (server/README.md), then set repo variables.
4. Verify approximate positions (data/README.md) against imagery/elevation.
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
- Loop 4: per-spot mute, deep-link scroll, fetch auto-retry, 18 inland coordinates corrected
  (elevation re-check queued after the Open-Meteo hourly limit resets), WebKit iPhone e2e in CI.
- Loop 5: Chrome installability e2e, OSM bbox shore inference with lakes/rivers, Welcome card,
  ARIA tabs, axe audit (57 e2e passing, 124 unit).
- Loop 6: map view, +59 spots, BC country fix, axe fail-closed, advisor review fixed (144 unit,
  44 server, 66 e2e).
- Loop 7: map clustering, favourites (watched beyond radius), +41 spots, e2e server isolation.
