/**
 * Suggest rideable sectors for curated spots with unknown sectors from OSM coastline data.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/infer-sectors.ts           # write data/sector-suggestions.json
 *   node --import ./scripts/ts-resolve.mjs scripts/infer-sectors.ts --apply   # apply that file to data/spots.json
 *
 * The default run makes one Overpass request per unknown spot (>= 5 s apart, backoff on 429/504)
 * and never touches data/spots.json. `--apply` makes no network calls: it applies only sea/lake
 * suggestions within 500 m of the shore and appends " Sectors inferred from OSM coastline." to notes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { applySuggestions, formatSpots, inferAll, isKnown, selectUnknown, type CuratedSpot, type Suggestion } from './sector-suggest';

const SPOTS = 'data/spots.json';
const SUGGESTIONS = 'data/sector-suggestions.json';

const spots = JSON.parse(readFileSync(SPOTS, 'utf8')) as CuratedSpot[];

if (process.argv.includes('--apply')) {
  const suggestions = JSON.parse(readFileSync(SUGGESTIONS, 'utf8')) as Suggestion[];
  const r = applySuggestions(spots, suggestions);
  writeFileSync(SPOTS, formatSpots(r.spots));
  console.log(`applied ${r.applied.length} of ${suggestions.length} suggestions: ${r.applied.join(', ') || '(none)'}`);
} else {
  const unknown = selectUnknown(spots);
  console.log(`${unknown.length} curated spots with unknown sectors`);
  const suggestions = await inferAll(unknown, {
    fetch: globalThis.fetch,
    sleep: (ms) => sleep(ms),
    now: Date.now,
    log: (m) => console.log(m),
  });
  writeFileSync(SUGGESTIONS, JSON.stringify(suggestions, null, 2) + '\n');
  console.log(`wrote ${SUGGESTIONS}: ${suggestions.filter(isKnown).length} inferred, ${suggestions.filter((s) => !isKnown(s)).length} unknown`);
}
