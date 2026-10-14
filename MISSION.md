# gust — mission

This file is the source of truth for every agent session that works on this repo.
Read it fully at the start of every session. Keep `PROGRESS.md` updated.

## Product

**gust** pings you when the wind is on at kiteboarding spots near you.

- Finds kite spots near the phone's current location (and near saved places).
- Scores each spot from live and forecast wind: speed, gusts, and whether the
  direction is rideable for that spot (onshore / side-onshore / side; offshore is
  unsafe and never scores as good).
- User sets a wind window (default 15–30 kn, gusts ≤ 35 kn), units (kn / mph / m/s),
  and search radius (default 50 km).
- Alerts: notification when a nearby spot turns good, plus a "good window ahead"
  forecast alert.
- Installable to a phone straight from the website. No App Store.

## Hard requirements

1. End-to-end working: the owner must be able to open the website on an iPhone or
   Android phone, tap Install, get the app on the home screen, grant location and
   notifications, and see real nearby spots with real wind.
2. Public repo `refcell/gust`, default branch `main`. Commit and push to `origin main`
   after every working increment — at least every 30 minutes of work. Never leave
   finished work unpushed. Keep `main` deployable (CI green).
3. Never get blocked. If something needs a human (credentials, accounts, payment,
   App Store, a design decision), pick the best no-account fallback, record the choice
   and the upgrade path in `PROGRESS.md` under "Decisions", and keep going. Never stop
   to ask a question and wait.
4. Use teams of agents (the `subagent` tool; the owner explicitly authorizes
   delegation for this repo): scouts for research, parallel workers on independent
   lanes (isolate concurrent writers with worktrees, one writer per worktree), and a
   fresh advisor review from a different model family before declaring a milestone
   done. The parent session integrates, verifies, commits, and pushes.

## Architecture (default choices — change only with a recorded reason)

- **App**: Progressive Web App (TypeScript + Vite; Preact or vanilla — keep the bundle
  small). Web app manifest, service worker (offline shell + cached last results),
  icons for iOS (`apple-touch-icon`) and Android (maskable), `display: standalone`.
- **Hosting**: GitHub Pages via a GitHub Actions workflow, at
  `https://refcell.github.io/gust/`. Landing page at `/`, app at `/app/`.
  Pages is already enabled with `build_type=workflow`.
- **Wind data**: Open-Meteo (`api.open-meteo.com/v1/forecast`: `wind_speed_10m`,
  `wind_gusts_10m`, `wind_direction_10m`, current + hourly; no API key, CORS ok).
- **Spots**: bundled curated dataset (`data/spots.json`: name, lat, lon, country,
  rideable direction sectors, notes) covering well-known spots worldwide — and in
  depth for the US (CA, OR, HI, TX, NC, FL, MA, etc.). Augment at runtime with
  OpenStreetMap Overpass (`sport=kitesurfing`) and cache the results. Spots without
  known sectors: infer the shore orientation from OSM coastline data when feasible,
  otherwise score speed only and mark direction as "unknown".
- **Alerts** (be honest about platform limits in README and in the app):
  - In-app: checks on open and on resume; local notification through the service
    worker when a spot crosses into "good".
  - Android/Chrome: Periodic Background Sync where supported.
  - iOS: Web Push only works for installed PWAs (iOS 16.4+) and needs a push sender.
    iOS PWAs cannot read location in the background. So background alerts use the
    last known location plus saved places.
  - Push sender: there are no deploy-platform credentials on the owner's machine.
    Ship a no-account path first. Then build a small, self-contained push backend (Web
    Push + VAPID, e.g. a Cloudflare Worker + KV or Deno Deploy) in `server/`, with
    tests and one-command deploy docs. The app enables background push automatically
    when `VITE_PUSH_API` is set at build time. If you find working credentials, deploy
    it. Do not block on this.
- **Android extra**: build a TWA/Capacitor APK in GitHub Actions and attach it to a
  GitHub Release, with a "Download APK" link on the site. Optional; do it after the PWA
  works.

## Website (landing page)

A clean, minimal, developer-grade page in the spirit of https://ampcode.com: restrained
typography (system font stack, or self-hosted fonts only — no Google Fonts), lots of
whitespace, near-monochrome palette with one accent, dark/light aware, single column.
No AI-slop: no gradients, glows, emoji bullets, stat-pill grids, or filler sections.

- A big primary **Install** button:
  - Android / desktop Chrome: triggers `beforeinstallprompt`.
  - iOS Safari: opens a short sheet with the exact steps (Share → Add to Home Screen),
    with a small illustration. Detect in-app browsers and tell users to open in Safari.
  - Desktop: show a QR code that opens the site on a phone.
- A live demo: a phone-frame embed of the real app or a recorded loop, plus a one-line
  pitch, a "how it works" section (three short plain paragraphs), and a link to GitHub.

## README

Model it on https://github.com/clabby/tact: `# gust`, a row of badges (CI, license,
Pages deploy), a one-sentence tagline, then an embedded demo (`assets/demo.mp4` or a
GIF recorded with Playwright in a mobile viewport and converted with `ffmpeg`, which is
installed at `/opt/homebrew/bin/ffmpeg`). Then plain, technical sections:
Install, How it works, Alerts and platform limits, Data sources, Configuration,
Development (`bun`/`pnpm` commands), Self-hosting the push backend, License (MIT).
Direct tone, no marketing fluff, no emoji.

## Quality bar

- Unit tests for scoring, direction-sector math, unit conversion, and spot search.
- Playwright e2e for the landing page and the app (mocked geolocation + network).
- Lighthouse PWA/installability checks pass; the manifest and service worker are valid.
- CI on every push: typecheck, lint, test, build, deploy Pages from `main`.
- Accessible: keyboard and screen-reader friendly, good contrast, works offline after
  the first load.

## Definition of done

The live site at https://refcell.github.io/gust/ installs on iOS and Android, shows real
nearby spots with live wind and scores, sends a notification when a spot turns good,
and has the README demo and docs. After that, keep improving: more spots, better
direction inference, forecast alerts, push backend, APK, polish. Log each loop in
`PROGRESS.md`.
