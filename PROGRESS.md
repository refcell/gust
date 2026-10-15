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
  Coastline inference: nearest segment within 1.5 km, seaward normal ±90° (was ±100°; narrowed in loop 8 so inferred sectors never include cross-offshore); closed lakes >= 0.5 km².
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
  changes, tile freshness per OSM policy, stale shore cache, antimeridian). All fixed:
  - Settings/watch list persist + push sync only from the settings path, with revisions (older
    intents dropped before save/POST); refreshes never write settings.
  - Push sends <= 60 spots (`src/lib/limits.ts`, shared with the server): favourites nearest first,
    then nearest; Alerts panel says when background alerts cover N of M.
  - Refresh reuses samples < 10 min old and fetches only missing spots; one refresh in flight plus
    at most one follow-up. Refresh button forces all.
  - Favourite spot snapshots (`gust.favSpots`) keep OSM favourites watched while travelling; with no
    origin, favourites are still listed/watched ("distance unknown").
  - Inferred sectors normal ±90°; shore cache key `shore:v2:` discards older inference.
  - Tile cache honours max-age/Expires, else 7 days (fetch time in `x-gust-fetched`); stale tiles
    revalidate with offline fallback; FIFO cap 200.
  - Dateline-aware fitting (shortest wrapped span) and clustering (periodic x).
- e2e webServer runs `./node_modules/.bin/vite preview` (pnpm refuses in worktrees with a
  symlinked node_modules).
- `PW_PORT` overrides the e2e port so parallel worktrees can run Playwright side by side.

- Lighthouse runs in CI after each deploy (report-only, reports uploaded): live app 100/100/100/100
  with CLS 0.001, so the local 0.384 was a local artifact. Landing scored 90-93, all from the
  embedded demo booting (TBT 340 ms). The landing now shows a still poster (light/dark JPEGs from
  `scripts/poster.mjs`) and boots the live app only when the phone frame is >= 60% visible or on
  "Start live demo"; no-JS gets a link.
- Kimi K3 review of loop 8: no must-fix. Fixed: favourite snapshots refresh when the dataset entry
  changes (safety corrections win) and stay storage-backed; cached tiles drop wire-encoding headers.
  Accepted: "latest value" refs written during render (Preact sync render; documented pattern).
- Spot coordinate check runs on the runner (retries 429/network); vietnam-hon-rom moved off inland
  hills to an approximate beach position; known inland lake spots skipped by name.

- Marine conditions (waves, period, direction, water temp + wetsuit hint, tide trend/next extreme)
  from the Open-Meteo Marine API, lazily per expanded spot, cached 1 h (memory + SW data cache).
  4xx/all-null = no marine data (inland); tide is modelled hourly sea level.
- Calendar export (.ics) of the next 48 h of good windows at watched, non-muted spots with a
  60-min VALARM: the no-account background alert path on iOS. Stable UID per spot+start; shifted
  windows leave old events (no delete without a feed; upgrade path: subscribable feed from the
  push server).
- DST (corrected in loop 11): Open-Meteo writes every timestamp in a response at its single
  `utc_offset_seconds`, even across a clock change (verified: Adelaide 3-5 Oct 2026, 72/72 hours
  match the fixed offset vs `timeformat=unixtime`). The loop-10 Intl zone conversion was wrong and
  is removed; API timestamps always use the fixed offset.

- gpt-6.1-sol review of loops 9-10: blocker (DST conversion, above) fixed; marine forecasts past
  their last hour show nothing (expired offline caches never look current); marine fetches time out
  after 10 s; calendar SEQUENCE is a persisted strictly increasing counter (`gust.icsSeq`, clamped to
  signed 32-bit). Open: installed-iPhone Blob -> Calendar handoff needs device acceptance.
- Docs audit: README/data/server READMEs re-verified against code; scripts + workflows tables.

- Calendar export in the installed iOS app prefers the share sheet with the .ics file (Web Share
  Level 2) and falls back to opening the Blob URL (navigation if the popup is blocked). Browser tabs
  keep the anchor download.

- Gap spots (loop 13): +33 spots in 12 new countries (720 total, 87 countries), each moved onto the
  OSM coastline via the OSM API (no Overpass/Open-Meteo). No sourced wind directions, so sectors are
  [] (speed-only scoring) until the sector-inference workflow fills them. Dropped two doubtful
  entries (philippines-bulalacao, norway-verket); low-confidence positions listed in data/README.
- Sector inference first run (loop 14): Overpass answered 500/504 for most requests and the job
  hit its 30 min limit after 18 of 21 spots without saving. The script now saves after every spot
  and resumes (mergeResults never downgrades an inference); job limit 150 min. From that run's log,
  7 suggestions were reviewed and applied; lagoons/causeways and >500 m entries were rejected (list
  in data/README "Sector inference").
- No-account background push (loop 27): scheduled GitHub Actions workflow `ntfy-alerts.yml`
  (every 15 min) scores the spots from the GUST_ALERTS_CONFIG repo variable (copied from the app's
  Alerts panel) with the server's alert logic (3 + summary, quiet hours, rollback on failed publish)
  and publishes to the ntfy.sh topic in the NTFY_TOPIC secret; the free ntfy app delivers real push
  on iOS and Android. State persists via actions/cache. Unconfigured: exits 0. Verified live with a
  throwaway topic (3 forecast alerts published with click links; second run deduped). Limits:
  GitHub schedule delays, 60-day inactivity disable, cache expiry after 7 days (first-run
  semantics), topic is a shared secret. Upgrade path stays the Cloudflare push backend.
- Accepted (loop 26): app Lighthouse performance varies 77-100 between runs with no code change
  (TBT 40-730 ms, LCP 1.3-3.7 s; the 77 followed a data-only commit). CPU profiles at 4x throttle
  (mocked wind, mocked and live Overpass) show ~40 ms of app work, so this is shared-runner noise
  plus live-API latency in demo mode; not chased further.
- Accepted: forecast hour labels use the response's fixed offset, so for spots whose clocks change
  inside the 48 h window, labels after the change read 1 h off (instants, alerts and calendar times
  are exact). Rewriting labels per IANA zone would touch every string comparison; not worth it.
- Offline sector inference (loop 12): `scripts/infer-sectors.ts` (run with
  `node --import ./scripts/ts-resolve.mjs`, a ~15-line extension resolver, no bundling) reuses the
  app's Overpass query/parse and `inferShoreDetailed` (coastline.ts; `inferShore` unchanged). It
  writes `data/sector-suggestions.json` for review; `--apply` only fills spots still `[]` from
  sea/lake suggestions <= 500 m from shore. Runs on GitHub's runner via the manual
  `infer-sectors.yml` workflow (artifact, never commits). Lagoons mapped as OSM coastline come out
  as "sea": suggestions are reviewed by hand before applying.

## Next

1. Physical-device acceptance (owner): iPhone Safari install -> location -> Enable alerts -> test
   notification -> calendar export opens in Calendar with reminders; Android Chrome install + APK sideload. Everything else is verified in CI/live.
2. Owner: enable ntfy background alerts (README "Background alerts with ntfy"): install ntfy,
   generate a topic in Alerts, set secret NTFY_TOPIC and variable GUST_ALERTS_CONFIG. Deploy the
   push backend when credentials exist (server/README.md).
4. Verify approximate positions (data/README.md) against imagery/elevation.
5. Verify spot coordinates against OSM shore data: `scripts/check-shore.ts` + manual "Check spot
   positions" workflow (loop 20); review data/position-proposals.json and apply approved moves.

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
- Loop 8: advisor blockers + should-fix all addressed (186 unit, 44 server, 72 e2e).
- Loop 9: Kimi review fixes, Lighthouse CI, landing demo poster (TBT), coordinate check in CI.
- Loop 10: marine conditions, calendar export (iOS background fallback), DST-correct window times
  (213 unit, 90 e2e).
- Docs audit: README, data/README, server/README checked against code (features, limits, scripts, workflows, spot ids).
- Loop 11: docs audit, demo re-record (marine), review fixes (DST revert, marine expiry/timeout,
  monotonic SEQUENCE).
- Loop 12: iOS share-sheet calendar export; offline sector inference script + manual workflow.
- Loop 13: +33 gap-region spots (12 new countries).
- Loop 14: sectors for 7 spots from the first inference run; resumable inference.
- Loop 15: second inference run (31/40 Overpass failures from the runner); 7 more reviewed sectors applied.
- Loop 16: gpt-6.1-sol review of loops 11-14. Fixed: --apply only uses entries with
  `review: approved` and coordinates matching the spot (rejections persisted in the file); resume
  re-infers moved spots; Murrell Park reverted to [] (inferred shore was not the launch; notes say
  S wind); Kappalady moved ~13 km to the lagoon south of Kalpitiya; calendar export no longer fails
  when storage throws; share path checks both APIs and falls back on synchronous errors; note
  annotation shortened to " OSM-inferred sectors." and a dataset test enforces notes <= 140 chars;
  README/data README document the inference workflow. Share-sheet acceptance on a real iPhone stays
  on the owner's device checklist.
- Loop 17: third inference run: 3 more approved (zanzibar-bwejuu, bulgaria-burgas, martinique-cap-chevalier), lithuania-svencele rejected (lagoon shore faced the wrong way). 28 spots keep failing Overpass from the runner; left [] (speed-only scoring).
- Loop 18: root cause of repeated Overpass failures was our 25 s client timeout (busy instances
  queue requests before the 25 s query timeout starts); `OverpassDeps.timeoutMs` lets the script
  allow 120 s (app unchanged). Fourth run inferred 15 of 28: 7 approved (djerba x2, bali-mertasari,
  sumbawa-lakey, romania-vadu, antigua-nonsuch-bay, finland-yyteri); rejected >500 m entries,
  lagoon spots where the outer coast was picked (Emerald Sea, Filim, Kappalady), the Rewa spit, and
  Puerto Velero (sector would exclude its NE trades). 13 still fail.
- Loop 19: fifth inference run: 6 more approved (kenya-lamu-shela, namibia-langstrand,
  norway-solastranden, estonia-parnu, turkey-cesme-pirlanta, montenegro-ulcinj-kabanya);
  bvi-trellis-bay rejected (inferred north-facing shore would make its E trades offshore). 6 spots
  still fail Overpass; 25 curated spots remain [] in total.
- Loop 20: shore check for all curated spots (distance to nearest OSM shore, resumable, review-gated position proposals); workflow check-shore.yml.
- Loop 21: landing Lighthouse performance swung 76-100 (TBT 0-1150 ms) because Lighthouse's
  full-page screenshot grows the viewport, the demo frame becomes 60% visible and the app iframe
  boots mid-trace. Auto-boot now waits for a first scroll/wheel/touch/pointer/key event before
  observing visibility; e2e covers a 3000 px viewport without engagement.
- Loop 22: Kimi K3 review of the shore check. Fixed: approved moves within 1.5 km of another spot
  are skipped, and a dataset test fails on any pair within 1.5 km not on a 6-pair known-close list;
  `--only`/`--limit` values starting with `--` are rejected and cannot switch modes; workflow
  concurrency group; approved-but-ineligible sector suggestions are reported as skipped; README
  caveat for 2-3 km proposals.
- Loop 23: Places search also finds curated spots by name (case/diacritic-insensitive, word-prefix
  first) with a Favourite toggle (favouriting watches a spot anywhere) and Show for spots already in
  the list; one shared toggleFavorite in App; axe audit covers the results.
- Loop 24: visual polish pass from 78 screenshots (scripts/ux-shots.mjs: 360/390/768 px, light and
  dark, mocked network): map controls no longer overlap the sticky header, aligned fact lists and
  card text, spot action buttons grouped, all tap targets >= 44 px, wrapping fixes, tab switches
  scroll to top. Header is 8 px taller (44 px refresh button).
- Loop 25: shore check run 1 measured 333/720 spots (386 Overpass failures; run 2 dispatched, it
  resumes from the committed data/shore-check.json). Decision: only review moves > 1 km (wind grid
  cells are >= 1.5 km, so sub-km errors only affect map placement and shore inference). Moved 10:
  salinas-del-rey, rodrigues-mourouk, taiwan-penghu, lake-mead-boulder-beach, cheney-reservoir,
  new-caledonia-poe, sri-lanka-mannar, au-hobart-seven-mile-beach, el-gouna to the nearest shore,
  and el-yaque hand-set ~4.8 km south to the town beach (proposal pointed at a lagoon; fits its
  curated S-facing sectors). Rejected skyway-beach (causeway) and ilha-do-guajiru (lagoon). The
  other 158 proposals (150 m-1 km) stay unreviewed.
- Loop 27: ntfy background alerts via scheduled Actions (no account); live-verified with a test topic.
- Loop 29: ntfy workflow verified on GitHub with throwaway secrets (secrets masked in logs; run 1
  published 3 alerts and saved state to actions/cache; run 2 restored it), then the secrets were
  deleted. Found: run 2 re-alerted the same Maui session because the forecast window start shifted
  08:00 -> 05:00 between runs and dedup keyed on the exact start. Forecast dedup (src/lib/alerts.ts,
  shared by app, push server and ntfy) now skips a window starting within 6 h of one already
  notified for that spot.
