import type { Spot } from './types';

/** Lower-case, strip diacritics (NFD + remove combining marks). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/**
 * Rank of `spot` for the folded `term`: 0 = a word of the name or id starts with the term,
 * 1 = the term appears inside the name or id, null = no match.
 */
function rank(spot: Spot, term: string): 0 | 1 | null {
  const fields = [foldText(spot.name), foldText(spot.id)];
  if (fields.some((f) => f.startsWith(term) || f.split(WORD_SPLIT).some((w) => w.startsWith(term)))) return 0;
  if (fields.some((f) => f.includes(term))) return 1;
  return null;
}

/**
 * Spots whose name or id matches `term` (case- and diacritic-insensitive). Word-prefix matches
 * come before substring matches, then by name. Terms shorter than 2 characters match nothing.
 */
export function searchSpots(spots: readonly Spot[], term: string, limit = 5): Spot[] {
  const t = foldText(term.trim());
  if (t.length < 2 || limit <= 0) return [];
  const hits: { spot: Spot; r: 0 | 1 }[] = [];
  for (const spot of spots) {
    const r = rank(spot, t);
    if (r !== null) hits.push({ spot, r });
  }
  hits.sort((a, b) => a.r - b.r || a.spot.name.localeCompare(b.spot.name) || a.spot.id.localeCompare(b.spot.id));
  return hits.slice(0, limit).map((h) => h.spot);
}
