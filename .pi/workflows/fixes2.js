const common = `You are in a git worktree of refcell/gust, a kiteboarding wind-alert PWA (Vite 8 + Preact + TS 5.9). Read MISSION.md and PROGRESS.md (Decisions) first. pnpm install may fail in worktrees; run tools from ./node_modules/.bin (tsc --noEmit, tsc -p server, eslint ., vitest run, vitest run --root server, vite build). For e2e run \`PW_PORT=$PORT ./node_modules/.bin/playwright test\` (it builds nothing: run vite build first; it starts and stops its own preview server on that port). Never start a server on 4173. No network calls in tests. Commit in the worktree; do not push; do not edit PROGRESS.md or README.md. Preact rules: no conditional hooks, effects with listeners/timers clean up, no state synced from props, no clickable div/span. Final answer (short): commit hash, what changed, verification, decisions.`;

const res = await runs.all([
  {
    key: 'sync',
    agent: 'worker',
    task: `${common.replace('$PORT', '4174')}

Fix these verified review findings (src/app/App.tsx, src/app/background.ts, src/lib/pushsync.ts, src/lib/watch.ts, src/lib/openmeteo.ts or src/app/data.ts, src/app/AlertsPanel.tsx, tests):
1. BLOCKER: App.tsx ~178-198 calls enableBackground with settings captured BEFORE awaiting weather; an older refresh finishing after a newer mute re-enqueues the unmuted subscription and overwrites IndexedDB (background.ts ~59-60, 83) with the old snapshot; pushsync orders by enqueue time not settings revision. Fix: remove settings persistence/push sync from the weather-refresh completion path entirely (persist settings/watch list to IDB in the settings/watch-change path; the push sync effect already exists) and give each sync intent a monotonically increasing revision so older intents are discarded before persistence or POST. Add a test where two refreshes resolve in reverse order and the newer (muted) settings win.
2. BLOCKER: server/src/validate.ts ~7,95 rejects >60 spots, but the client sends every unmuted watched spot (favourites unbounded) -> the whole update is rejected and the server keeps old settings incl. old mute state. Fix: client-side, send at most 60 spots prioritised: favourites first (nearest first), then nearest others; never drop the update. Show a visible note in the Alerts panel when background alerts cover only N of M watched spots ("Background alerts cover your 60 nearest/favourite spots; in-app checks cover all"). Keep server limit at 60 (KV/Open-Meteo budget) — share the constant if practical. Unit-test prioritisation.
3. Should-fix: avoid refetching weather on scoring-only changes (wind window, units, mute, favourites when already-fetched spots): reuse fresh samples (<10 min) and only fetch missing spots; coalesce concurrent refreshes (one in flight; a request arriving during it schedules one follow-up). Unit-test the "which spots need fetching" helper.
4. Should-fix: favourites from OSM disappear when the OSM dataset changes (watch.ts resolves IDs only against current spots). Persist a snapshot of favourited spot objects (localStorage key gust.favSpots, updated when favouriting) and include them in the spot universe so favourites stay watched while travelling; also when there is no origin, curated/OSM favourites should still be watched (distance shown as unknown). Unit-test.`,
  },
  {
    key: 'geo',
    agent: 'worker',
    task: `${common.replace('$PORT', '4175')}

Fix these verified review findings (src/lib/coastline.ts, src/lib/score.ts tests, src/app/osm.ts, src/sw/sw.ts, src/lib/tiles.ts, src/lib/cluster.ts, src/app/SpotMap.tsx, tests):
1. BLOCKER (safety): inferred sectors use seaward normal ±100° (coastline.ts ~36,128-129), which includes cross-offshore wind rated Good. Change INFERRED sectors to ±90° (side-shore max). Curated data is unaffected. Add scoring regressions: inferred east-facing shore; wind from normal±89° can be Good, normal±95° is at most 'ok' (marginal band) and normal±110° is offshore/0.
2. Should-fix: version the derived shore cache key in src/app/osm.ts (~16-18) (e.g. bump a SHORE_CACHE_VERSION in the key) so cached sectors from before the island fix and the ±90° change are discarded. Unit-test that an old-version entry is ignored.
3. Should-fix (OSM tile policy): src/sw/sw.ts ~49-58 serves cached tiles forever. Implement: cache-first while fresh, where freshness = response Cache-Control max-age / Expires if readable, else 7 days (store the fetch time in a header on the cached Response copy, e.g. x-gust-fetched); when stale, fetch from network (revalidate) and fall back to the stale copy offline/on error. Keep the 200-entry cap; make eviction LRU-ish by re-putting on hit only when cheap, or document FIFO. Unit-test the freshness function (extract pure helper into src/lib/ e.g. tilecache.ts).
4. Should-fix: antimeridian. tiles.ts ~63-68 fit uses unwrapped longitude span; clustering in SpotMap.tsx ~183-187 / cluster.ts uses unwrapped world x. Use the shortest wrapped longitude span for fitting and periodic x-distance for clustering/centroids. Add dateline regression tests (spots at 179.9 and -179.9 cluster together and fit centred near 180).`,
  },
]);
return res.map((r) => ({ key: r.key, status: r.status, output: r.output }));
