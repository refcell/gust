const common = `You are in a git worktree of refcell/gust, a kiteboarding wind-alert PWA (Vite 8 + Preact + TS 5.9). Read MISSION.md and PROGRESS.md (Decisions) first. pnpm install may fail in worktrees; run tools from ./node_modules/.bin (tsc --noEmit, eslint ., vitest run, vite build; for e2e start \`./node_modules/.bin/vite preview --port 4173 --strictPort\` yourself, then \`./node_modules/.bin/playwright test\`). Keep all checks passing. Do not call Open-Meteo or Overpass from scripts (rate limited); tests mock network. Commit in the worktree; do not push; do not edit PROGRESS.md or README.md. Final answer (short): commit hash(es), what changed, verification, decisions to record.`;

const res = await runs.all([
  {
    key: 'map',
    agent: 'worker',
    task: `${common}

Lane: a Map view of nearby spots in the app. Add a "List | Map" segmented toggle at the top of the Spots view (persist choice in localStorage). The map is a lazily imported chunk (dynamic import) so the list view bundle does not grow; implement it WITHOUT new npm dependencies (no lockfile changes possible here): a small Preact slippy map rendering OpenStreetMap raster tiles (https://tile.openstreetmap.org/{z}/{x}/{y}.png, with visible "© OpenStreetMap contributors" attribution link, per the OSM tile usage policy) with pointer-drag pan, pinch/wheel zoom (zoom 3–15), and +/- buttons. Markers: one per watched/nearby spot, coloured by score (reuse existing score colours/classes, plus a text label for colour-blind users via aria-label and a visible rating letter or short word), the user location as a dot, and the radius as a circle. Tapping a marker selects the spot and shows a compact card (name, wind, score, "Open details" which switches to the list with that spot open and scrolled into view). Markers must be <button>s with aria-labels; keyboard: Tab through markers. Effects that add pointer/wheel listeners must clean up. The service worker must not precache tiles; add a runtime cache for tile.openstreetmap.org with a small cap (e.g. 200 entries, cache-first, stale ok) in src/sw/sw.ts. Fit the initial view to the location + radius. Unit-test the tile math (lat/lon <-> tile/pixel) and add an e2e test (route tile requests to a 1x1 PNG) that switches to Map, sees markers, taps one, and opens details. Run the axe e2e (e2e/a11y.spec.ts) for the map view too (add a case). Mobile first, 44px tap targets.`,
  },
  {
    key: 'spots',
    agent: 'worker',
    task: `${common}

Lane: add ~150 well-known, real kiteboarding spots in under-covered regions, written to data/new-lane4.json (array of spot objects with exactly the schema in data/spots.json — read data/README.md and a few existing entries, and tests/dataset-safety.test.ts). Then run \`node scripts/merge-spots.mjs\` to validate/dedupe/merge into data/spots.json (it deletes the source file), and run the unit tests. Targets: US inland lakes and reservoirs popular with kiters (Great Lakes shore spots, Texas/Oklahoma lakes, Utah, Colorado, Idaho, Montana, Minnesota, Wisconsin), US Gulf and Atlantic gaps (check existing coverage first, avoid duplicates within 1.5 km), plus Asia (Philippines, Vietnam, Thailand, Sri Lanka, India, Japan, Korea), Africa (Morocco, Egypt, Kenya, Tanzania, Madagascar, Senegal, Cape Verde), South America (Brazil NE beyond existing, Peru, Uruguay, Argentina, Venezuela/Colombia), and Oceania gaps. Only include spots you are confident exist as kite spots. Coordinates must be ON the shore/launch beach (5 decimals). Sectors: rideable = onshore/side-onshore only, within the seaward normal ±100°, never offshore; if unsure of orientation, use sectors: [] (unknown) rather than guessing. [0,360] only for documented any-direction spots with notes starting "Any direction". Fill notes with a short hazard/launch hint when known.`,
  },
  {
    key: 'review',
    agent: 'advisor',
    model: 'cbhq-openai/gpt-6.1-sol',
    task: `Mode: review implementation. Repo: /Users/andreasbigger/dev/gust (read-only; do not edit). Read MISSION.md and PROGRESS.md. Review the changes from the last ~12 commits (git log -12; git diff HEAD~12 -- src server e2e scripts) for correctness and safety: per-spot mute (src/lib/alerts.ts, background.ts, App.tsx, SpotCard.tsx), cron delivery-aware rollback (server/src/cron.ts), fetch auto-retry, OSM bbox shore inference with multipolygon lakes and rivers (src/lib/overpass.ts, src/lib/coastline.ts, src/app/osm.ts), Welcome card + ARIA tabs (src/app/Welcome.tsx, App.tsx), and e2e installability/axe tests. Flag only must-fix bugs and important should-fix items, each with file:line, why, and a concrete fix. Note React/Preact rule violations (conditional hooks, effects without cleanup, state synced from props, clickable div/span). Be concise.`,
  },
]);
return res.map((r) => ({ key: r.key, status: r.status, output: r.output }));
