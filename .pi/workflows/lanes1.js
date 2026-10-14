const common = `You are in a git worktree of refcell/gust, a kiteboarding wind-alert PWA (Vite 8 + Preact + TS 5.9, pnpm). Read MISSION.md and PROGRESS.md first, then skim src/lib/*.ts to reuse existing types and helpers. Run \`pnpm install\` first. Keep \`pnpm typecheck && pnpm lint && pnpm test && pnpm build\` passing. Commit your work in this worktree with clear conventional messages; do NOT push and do NOT edit PROGRESS.md or README.md (the lead integrates docs). Final answer: worktree path, branch, commits, what you built, how you verified it, and any follow-ups or decisions the lead should record.`;

const res = await runs.all([
  {
    key: 'osm',
    agent: 'worker',
    task: `${common}

Lane: OpenStreetMap augmentation + shore-direction inference. Replace the placeholder in src/app/osm.ts.
- src/lib/overpass.ts: build an Overpass QL query for sport=kitesurfing (nwr, around:radius m, out center; also include leisure=beach_resort? no — just sport=kitesurfing and sport~"kitesurfing" in semicolon lists) and a second query for natural=coastline ways (out geom) near each spot lacking sectors (batch: one query with a union of around: filters, small radius ~1500 m). POST form-encoded data= to https://overpass-api.de/api/interpreter with fallback to https://overpass.kumi.systems/api/interpreter; [timeout:20]; handle 429/504 gracefully (return [] and back off).
- Strict caching because the public Overpass limit is ~100 requests/day across ALL users: cache results in localStorage (or the kv IndexedDB helper in src/lib/kv.ts) keyed by a coarse tile (e.g. round lat/lon to 0.5° plus radius bucket) for 14 days; never fetch more than once per tile per 14 days; also a global per-device cap (e.g. max 6 Overpass calls per day). Failures cached for 1 hour.
- src/lib/coastline.ts: pure functions. Given a spot point and coastline ways (arrays of lat/lon in node order; land is LEFT, water is RIGHT of travel direction), find the nearest segment, compute its bearing, the seaward normal = bearing + 90°, and derive rideable sectors = [normal-100, normal+100] normalised (onshore through side-shore; excludes offshore). Return null if nearest coastline is farther than ~1.5 km (lake/river spots: OSM lakes are natural=water polygons — optional: handle closed water polygons where water is INSIDE: compute normal pointing toward polygon interior; only if simple). Unit tests in tests/coastline.test.ts and tests/overpass.test.ts with synthetic geometries (e.g. a north-south coastline with water to the east => normal 90°, sectors [350, 190]) and parse tests for Overpass JSON (node with lat/lon, way with center, names, missing names => "Kite spot (OSM)").
- osm.ts augmentWithOsm(center, radiusKm, curated): returns new Spot objects (source:'osm', sectorSource:'coastline'|'unknown', id 'osm-<type>-<id>') deduped against curated within 1.5 km (use mergeSpots from src/lib/spots.ts). Must never throw.
- Add an e2e-safe behaviour: the existing e2e mocks already return {"elements":[]} for overpass endpoints.
- Keep the app bundle small; no new runtime deps.`,
  },
  {
    key: 'push',
    agent: 'worker',
    task: `${common}

Lane: self-contained Web Push backend in server/ (Cloudflare Worker + KV + Cron Trigger, VAPID). Only touch server/** plus, if needed, eslint.config.js ignores and vite.config.ts test.include (already includes server/test/**/*.test.ts). Give server/ its own package.json (wrangler as devDependency, @block65/webcrypto-web-push or an equivalent Workers-compatible lib — verify it actually works with tests; if a dependency is problematic, implement RFC 8291 aes128gcm + VAPID JWT (ES256) with WebCrypto yourself) and its own tsconfig. Do not add server deps to the root package.json; if root vitest needs to run server tests, make the tests import only code resolvable from the root (or run them via server's own vitest and add a root script "test:server"). Prefer: root \`pnpm test\` stays root-only; add root script \`"test:server": "pnpm --dir server test"\` and have CI-friendly instructions.

API contract (client already implemented in src/app/background.ts — read it):
- POST /subscribe {subscription, settings, location, spots:[{id,name,lat,lon,sectors}], tz} -> upsert in KV keyed by hash of endpoint; 200 {ok:true}. Validate & cap sizes (<= 60 spots, sane numbers). CORS for https://refcell.github.io and http://localhost:* .
- POST /unsubscribe {endpoint} -> delete.
- GET /health -> {ok:true, subscribers:n?}.
- GET /vapid -> {publicKey}.
- Cron (every 30 min): for each subscriber, fetch Open-Meteo for its spots (batched multi-location), score with the SAME logic as the client — import ../src/lib/score.ts, forecast.ts, alerts.ts, openmeteo.ts via relative paths (they are pure TS; wrangler/esbuild bundles them) — keep per-subscriber AlertState in KV, and send a ready-to-display push payload {title, body, tag, url} for each alert (the SW in src/sw/sw.ts shows payloads with a title). Delete subscriptions on 404/410. Respect quiet hours? optional: skip 22:00–06:00 in subscriber tz.
- wrangler.toml with KV binding SUBS and [triggers] crons, vars; secrets VAPID_PRIVATE_KEY (JWK or base64url d), VAPID_PUBLIC_KEY, VAPID_SUBJECT.
- scripts: server/scripts/gen-vapid.mjs generates a keypair and prints the wrangler secret commands and the VITE_VAPID_PUBLIC_KEY value.
- Tests (vitest, run in node with WebCrypto): payload encryption round-trip (decrypt with a generated receiver key to prove correctness per RFC 8291), VAPID JWT structure/signature verify, request validation, cron flow with mocked fetch + in-memory KV stub (alerts trigger pushes, 410 deletes subscriber).
- server/README.md: one-command deploy (\`cd server && pnpm i && pnpm run deploy\` after \`wrangler login\`, \`wrangler kv namespace create SUBS\`, setting secrets), then how to set repo variables VITE_PUSH_API and VITE_VAPID_PUBLIC_KEY (gh variable set ...) so CI builds the app with push enabled. Also document a Deno Deploy alternative briefly (optional).
Check whether wrangler credentials exist on this machine (\`npx wrangler whoami\` — non-interactive; do NOT run wrangler login). If authenticated, report it but do NOT deploy; the lead decides.`,
  },
  {
    key: 'apk',
    agent: 'worker',
    task: `${common}

Lane: Android APK built in GitHub Actions and attached to a GitHub Release. Only touch android/** and .github/workflows/android.yml (new file), plus scripts/ if needed. Approach: Bubblewrap TWA (@bubblewrap/cli) using the live manifest https://refcell.github.io/gust/manifest.webmanifest (scope /gust/, start_url /gust/app/?source=pwa), packageId io.github.refcell.gust. Commit a checked-in twa-manifest.json so the build is non-interactive (bubblewrap build with --skipPwaValidation; provide keystore + passwords via env; bubblewrap prompts for passwords — use BUBBLEWRAP_KEYSTORE_PASSWORD / BUBBLEWRAP_KEY_PASSWORD env vars which bubblewrap supports, verify in its source/docs). Signing: use repo secrets ANDROID_KEYSTORE_B64 / ANDROID_KEYSTORE_PASSWORD if present; otherwise generate a keystore with keytool in the job (document that updates won't install over a differently-signed APK; the upgrade path is to store a stable keystore as secrets). Have bubblewrap's JDK/SDK installed non-interactively (setup-java 17, android-actions/setup-android, and pre-write ~/.bubblewrap/config.json with jdkPath/androidSdkPath). Workflow triggers: workflow_dispatch and push of tags v*; also on push to main when android/** changes. Output app-release-signed.apk; create/update a release with softprops/action-gh-release (tag apk-latest or the pushed tag) and permissions contents: write. Also print the SHA-256 cert fingerprint and generate an assetlinks.json artifact (Digital Asset Links). Note: refcell.github.io root is NOT controlled by this repo (refcell/refcell.github.io does not exist), so TWA verification will fail and Chrome shows a URL bar — document in android/README.md the upgrade path (create refcell/refcell.github.io with .well-known/assetlinks.json, or a custom domain). Alternative if bubblewrap cannot be made non-interactive: a minimal hand-written Android project (Gradle) using androidx.browser TWA LauncherActivity (com.google.androidbrowserhelper:androidbrowserhelper) — that is often MORE reliable in CI than bubblewrap; choose whichever you can verify. You probably cannot run the Android build locally (check for java/android SDK; if absent, validate the workflow YAML with actionlint if available via npx or a docker-free method, and carefully reason about correctness). The lead will run it on GitHub after merging. Write android/README.md.`,
  },
]);
return res.map((r) => ({ key: r.key, status: r.status, output: r.output }));
