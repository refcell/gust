const common = `You are in a git worktree of refcell/gust, a kiteboarding wind-alert PWA (Vite 8 + Preact + TS 5.9). Read MISSION.md and PROGRESS.md (Decisions) first. pnpm install may fail in worktrees (node_modules symlink); run tools from ./node_modules/.bin (tsc --noEmit, eslint ., vitest run, vite build; for e2e start \`./node_modules/.bin/vite preview --port 4173 --strictPort\` yourself then \`./node_modules/.bin/playwright test\`). Keep all checks passing. Do not call Open-Meteo or Overpass from scripts (rate limits); tests must mock network. Commit in the worktree; do not push; do not edit PROGRESS.md or README.md. Final answer (short): branch, commit hash(es), what changed, verification, decisions to record.`;

const res = await runs.all([
  {
    key: 'osm2',
    agent: 'worker',
    task: `${common}

Lane: better shore-direction inference for OSM spots with unknown sectors (src/lib/overpass.ts, src/lib/coastline.ts, src/app/osm.ts, tests). Today the shore query unions up to 15 around: clauses per call. Replace with ONE bbox query per cached tile that returns natural=coastline ways and natural=water / water=lake|reservoir|lagoon closed ways and multipolygon relations (out geom) inside a bbox padded ~2 km around the tile's new OSM spots (cap bbox size; if too large, fall back to the nearest 15 spots). Then infer sectors for every unknown spot from that geometry locally. Add multipolygon relation support for lakes (outer rings; water inside). Keep the 14-day tile cache, 6 calls/day cap, backoff. Add tests with synthetic geometry including a multipolygon lake and a bbox fallback. Also: when the nearest shore is a river (natural=water + water=river polygon), treat as unknown (rivers make orientation ambiguous).`,
  },
  {
    key: 'ux',
    agent: 'worker',
    task: `${common}

Lane: first-run onboarding + accessibility audit in the app (src/app/*.tsx, src/app/styles.css, e2e/). (1) When there is no location and no saved places, replace the bare empty state with a short welcome card: one line on what gust does, then two numbered steps with buttons — "Share location" (calls the existing locate) and "Enable alerts" (calls the existing enableAlerts in App; on iOS not installed, show the install hint instead), plus a link "or add a place". Keep it plain (no illustrations/emoji), matching the existing minimal style. (2) Add @axe-core/playwright as a devDependency (pnpm add -D in the MAIN repo is not possible from the worktree — instead add it to package.json devDependencies manually with a caret version and note that the lead must run pnpm install; write the e2e test so it is skipped with a clear message if the module is missing) and an e2e test e2e/a11y.spec.ts that runs axe on the landing page, the app spot list (expanded spot), Settings, Alerts and Places with mocked network (reuse e2e/mocks.ts), failing on serious/critical violations. Fix any violations you find (labels, landmarks, contrast, aria). (3) Ensure all interactive elements are reachable and operable by keyboard with visible focus; the tab bar should use proper semantics. Rules for React/Preact: no hooks after early returns, effects that add listeners/timers must clean up, no clickable div/span.`,
  },
]);
return res.map((r) => ({ key: r.key, status: r.status, output: r.output }));
