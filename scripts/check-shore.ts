/**
 * Check every curated spot's coordinates against OSM shore data.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/check-shore.ts [--only id,id] [--limit N]
 *       measure distance to the nearest shore -> data/shore-check.json (Overpass, >= 5 s apart)
 *   node --import ./scripts/ts-resolve.mjs scripts/check-shore.ts --propose
 *       no network: data/position-proposals.json for spots 150-3000 m from the shore
 *   node --import ./scripts/ts-resolve.mjs scripts/check-shore.ts --apply-positions
 *       no network: move spots whose proposal is marked "review": "approved" (coordinates only)
 *
 * The measuring run uses the sector-inference Overpass query (~2 km box around the spot), saves after
 * every spot and resumes from the committed file: spots already checked at their current coordinates
 * are skipped, failed requests are retried. Commit the downloaded CI artifact to carry progress over.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { formatSpots, type CuratedSpot } from './sector-suggest';
import { applyPositions, checkAll, mergeChecks, proposePositions, selectPending, summarize, type PositionProposal, type ShoreCheck } from './shore-positions';

const SPOTS = 'data/spots.json';
const CHECKS = 'data/shore-check.json';
const PROPOSALS = 'data/position-proposals.json';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  // A value that looks like a flag (e.g. a workflow input of "--propose") must not switch modes.
  if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value, got ${v ?? 'nothing'}`);
  return v;
};
// Mode flags only count as standalone arguments, never as the value of --only / --limit.
const valueIdx = new Set(['--only', '--limit'].map((n) => args.indexOf(n)).filter((i) => i >= 0).map((i) => i + 1));
const has = (name: string) => args.some((a, i) => a === name && !valueIdx.has(i));
flag('--only');
flag('--limit');
const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback);

const spots = JSON.parse(readFileSync(SPOTS, 'utf8')) as CuratedSpot[];
const prev = readJson<ShoreCheck[]>(CHECKS, []);

if (has('--apply-positions')) {
  const r = applyPositions(spots, readJson<PositionProposal[]>(PROPOSALS, []));
  writeFileSync(SPOTS, formatSpots(r.spots));
  console.log(`moved ${r.applied.length} spots: ${r.applied.join(', ') || '(none)'}`);
  if (r.skipped.length) console.log(`skipped: ${r.skipped.join('; ')}`);
} else if (has('--propose')) {
  const proposals = proposePositions(spots, prev, readJson<PositionProposal[]>(PROPOSALS, []));
  writeFileSync(PROPOSALS, JSON.stringify(proposals, null, 2) + '\n');
  console.log(`wrote ${PROPOSALS}: ${proposals.length} proposals (${proposals.filter((p) => p.review).length} already reviewed)`);
} else {
  const only = flag('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const limitArg = flag('--limit');
  const limit = limitArg === undefined ? undefined : Number(limitArg);
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 0)) throw new Error(`--limit expects a non-negative integer, got ${limitArg}`);
  const pending = selectPending(spots, prev, { only, limit });
  console.log(`${pending.length} spots to check (${prev.length} entries in ${CHECKS})`);
  const save = (results: readonly ShoreCheck[]) => writeFileSync(CHECKS, JSON.stringify(mergeChecks(spots, prev, results), null, 2) + '\n');
  const results = await checkAll(pending, {
    fetch: globalThis.fetch,
    sleep: (ms) => sleep(ms),
    now: Date.now,
    log: (m) => console.log(m),
    onCheck: save,
  });
  save(results);
  console.log(summarize(mergeChecks(spots, prev, results), spots.length).join('\n'));
}
