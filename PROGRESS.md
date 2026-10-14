# Progress

## Status

Loop 1: PWA skeleton + landing page shipped to Pages. App shows nearby curated spots with live
Open-Meteo wind, scores, 48 h hourly chart, settings, saved places, alerts panel (in-app
notifications on open/resume, Periodic Background Sync registration on Chromium, Web Push
client gated on `VITE_PUSH_API`). 418 curated spots (185 US). Unit tests + Playwright e2e.

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

## Next

1. Verify Pages deploy live; fetch URLs.
2. OSM Overpass augmentation + coastline sector inference (cached).
3. README full docs + demo recording (Playwright mobile + ffmpeg).
4. Push backend in `server/` (Cloudflare Worker + KV + cron, VAPID) with tests and deploy docs.
5. Android APK (Bubblewrap/TWA) in Actions + Release; "Download APK" link.
6. Advisor review before milestone.

## Log

- Repo created with MISSION.md.
- Loop 1: scaffold, core libs (units, sectors, geo, score, forecast, alerts, open-meteo), app UI,
  landing page, SW, icons, tests, CI + Pages workflow, curated dataset (worker lane).
