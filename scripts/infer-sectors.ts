/**
 * Suggest rideable sectors for curated spots with unknown sectors from OSM coastline data.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/infer-sectors.ts           # write data/sector-suggestions.json
 *   node --import ./scripts/ts-resolve.mjs scripts/infer-sectors.ts --apply   # apply that file to data/spots.json
 *
 * The default run makes one Overpass request per unknown spot (>= 5 s apart, backoff on 429/504)
 * and never touches data/spots.json. `--apply` makes no network calls: it applies only entries marked
 * `"review": "approved"` (sea/lake, within 500 m of the shore, computed at the spot's current
 * coordinates) and appends " OSM-inferred sectors." to notes (skipped if notes would pass 140 chars).
 *
 * Progress is saved after every spot; a re-run resumes from the checked-in file, skipping spots
 * already inferred at their current coordinates (failed/unknown ones are retried). A CI run starts
 * from the committed file: commit the downloaded artifact to carry progress into the next dispatch.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { applySuggestions, formatSpots, inferAll, isKnown, mergeResults, samePlace, selectUnknown, type CuratedSpot, type Suggestion } from './sector-suggest';

const SPOTS = 'data/spots.json';
const SUGGESTIONS = 'data/sector-suggestions.json';

const spots = JSON.parse(readFileSync(SPOTS, 'utf8')) as CuratedSpot[];

if (process.argv.includes('--apply')) {
  const suggestions = JSON.parse(readFileSync(SUGGESTIONS, 'utf8')) as Suggestion[];
  const r = applySuggestions(spots, suggestions);
  writeFileSync(SPOTS, formatSpots(r.spots));
  console.log(`applied ${r.applied.length} approved suggestions: ${r.applied.join(', ') || '(none)'}`);
  if (r.skipped.length) console.log(`skipped: ${r.skipped.join('; ')}`);
} else {
  const prev = existsSync(SUGGESTIONS) ? (JSON.parse(readFileSync(SUGGESTIONS, 'utf8')) as Suggestion[]) : [];
  // Skip spots already inferred at their current coordinates; moved spots are inferred again.
  const at = new Map(spots.map((s) => [s.id, s]));
  const done = new Set(prev.filter((p) => isKnown(p) && at.has(p.id) && samePlace(p, at.get(p.id)!)).map((p) => p.id));
  const unknown = selectUnknown(spots).filter((s) => !done.has(s.id));
  console.log(`${unknown.length} curated spots with unknown sectors to infer (${done.size} already inferred)`);
  const save = (results: readonly Suggestion[]) => writeFileSync(SUGGESTIONS, JSON.stringify(mergeResults(prev, results), null, 2) + '\n');
  const results = await inferAll(unknown, {
    fetch: globalThis.fetch,
    sleep: (ms) => sleep(ms),
    now: Date.now,
    log: (m) => console.log(m),
    onResult: save,
  });
  save(results);
  const suggestions = mergeResults(prev, results);
  console.log(`wrote ${SUGGESTIONS}: ${suggestions.filter(isKnown).length} inferred, ${suggestions.filter((s) => !isKnown(s)).length} unknown`);
}
