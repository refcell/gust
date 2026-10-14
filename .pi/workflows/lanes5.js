const common = `You are in a git worktree of refcell/gust, a kiteboarding wind-alert PWA (Vite 8 + Preact + TS 5.9). Read MISSION.md and PROGRESS.md (Decisions) first. pnpm install may fail in worktrees; run tools from ./node_modules/.bin (tsc --noEmit, eslint ., vitest run, vite build; for e2e start \`./node_modules/.bin/vite preview --port 4173 --strictPort\` yourself, then \`./node_modules/.bin/playwright test\`). Keep all checks passing. Do not call Open-Meteo or Overpass from scripts (rate limited); tests mock network. Commit in the worktree; do not push; do not edit PROGRESS.md or README.md. Final answer (short): commit hash(es), what changed, verification, decisions to record.`;

const res = await runs.all([
  {
    key: 'fav',
    agent: 'worker',
    task: `${common}

Lane: map marker clustering + favourites (src/app/SpotMap.tsx, src/lib/tiles.ts or a new src/lib/cluster.ts, src/app/SpotCard.tsx, src/app/App.tsx, src/lib/types.ts, styles, tests, e2e).
(1) Clustering: at the current zoom, group markers whose screen positions are within ~40 px into one cluster button showing the count and the BEST rating colour among them (aria-label e.g. "4 spots, best Good. Zoom in"). Tapping a cluster zooms in centred on it (or, at max zoom, shows a list of its spots in the card). Pure, unit-tested grid/greedy clustering in screen space; recompute on zoom/pan only (memoized). Remove the e2e need to zoom 4x before tapping: update e2e/map.spec.ts and e2e/a11y.spec.ts accordingly.
(2) Favourites: a star toggle button (aria-pressed, label "Favourite") in the spot detail; persisted as settings.favorites?: string[] (optional field; server ignores unknown settings). Favourites sort first in the list (within each section, keep existing sort otherwise) and show a star marker; on the map, favourites get a ring. Favourites outside the radius stay listed under a "Favourites" section and ARE watched for alerts (unlike other fallback spots) — check how the watched set is computed in App.tsx/data.ts and add them; unit-test that selection logic (extract a pure helper if needed). Preact rules: no conditional hooks, effects with listeners/timers clean up, no state synced from props via effect, no clickable div/span. Mobile first, 44 px targets.`,
  },
  {
    key: 'spots',
    agent: 'worker',
    task: `${common}

Lane: add well-known, real kiteboarding spots in still-missing regions to data/new-lane5.json (exact schema of data/spots.json; read data/README.md, a few entries, tests/dataset-safety.test.ts), then run \`node scripts/merge-spots.mjs --keep\` to validate/dedupe and append into data/spots.json; afterwards restore any existing lines the merge script reformatted (git diff must show only appended spots; compare with git show HEAD:data/spots.json) and delete data/new-lane5.json. Regions: Colorado, Montana, Minnesota, Oklahoma, Nebraska/Kansas reservoirs, Nevada, Arizona, New Mexico, Georgia/South Carolina/Virginia/Maryland/Delaware/New Jersey/New York/Maine coasts (check existing coverage first; no duplicates within 1.5 km), Puerto Rico, US Virgin Islands; Philippines (Boracay Bulabog, Pagudpud, etc.), India (Rameswaram, Gujarat), Egypt (El Gouna, Soma Bay, Safaga, Ras Sudr, Dahab), Tanzania (Zanzibar Paje), Madagascar (Diego Suarez/Emerald Sea), Senegal, Oman, UAE, Israel, Greece/Turkey gaps, Canary Islands gaps, Caribbean gaps (Dominican Republic Cabarete/Buen Hombre, Bonaire, Curacao, Barbados, Turks & Caicos), Mexico gaps (La Ventana is there?), Canada (Squamish, Nitinat, Ontario/Quebec lakes, Nova Scotia; country CA). Only spots you are confident exist; coordinates ON the launch beach at the waterline (5 decimals). Sectors onshore/side-on only within seaward normal ±100°, never offshore; unsure -> sectors []. [0,360] only for documented any-direction with notes starting "Any direction". Short notes with hazards/launch hints. Aim for 100+ quality spots.`,
  },
]);
return res.map((r) => ({ key: r.key, status: r.status, output: r.output }));
