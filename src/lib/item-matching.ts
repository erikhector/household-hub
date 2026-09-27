// Pure fuzzy name-matching for mapping a freeform shopping-list item name to
// an existing InventoryItem — used by the shopping list's "needs mapping"
// flow (src/app/dashboard/shopping-list/actions.ts,
// src/components/shopping/map-shopping-item-dialog.tsx) instead of the old
// silent find-or-create-by-exact-name behavior. Dependency-free so it can
// run both server-side and directly in the client dialog.

/** Lowercase, Unicode-normalize, strip punctuation, collapse whitespace. */
export function normalizeItemName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .replace(/\s+/g, " ");
}

function bigrams(s: string): string[] {
  const grams: string[] = [];
  for (let i = 0; i < s.length - 1; i++) grams.push(s.slice(i, i + 2));
  return grams;
}

/** Dice's coefficient over character bigrams — a cheap, dependency-free
 * "how similar do these two strings look" score in [0, 1]. */
function diceCoefficient(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  let matches = 0;
  const remaining = [...bigramsB];
  for (const gram of bigramsA) {
    const idx = remaining.indexOf(gram);
    if (idx !== -1) {
      matches++;
      remaining.splice(idx, 1);
    }
  }
  return (2 * matches) / (bigramsA.length + bigramsB.length);
}

/**
 * Similarity between two item names in [0, 1]. Normalized equality
 * (case/whitespace/punctuation-insensitive) always scores exactly 1;
 * everything else falls back to bigram overlap, so close near-misses
 * ("Tomatoes" vs "tomato") score high but never as high as an exact match.
 */
export function itemNameSimilarity(a: string, b: string): number {
  const normA = normalizeItemName(a);
  const normB = normalizeItemName(b);
  if (normA === normB) return 1;
  return diceCoefficient(normA, normB);
}

// Confidence thresholds for a fuzzy name match, first tuned for receipt
// lines (AUTO-11, src/lib/shopping/receipt-match.ts) and shared with the
// recipe ingredient matcher (MATCH-1, src/lib/recipes/ingredient-match.ts)
// so both review screens accept and pre-select on exactly the same terms.
//
// Below this, defaulting to "skip"/"create new" is safer than confidently
// linking the wrong item — the user can still pick one manually. Same value
// both dialogs used before AUTO-11.
export const MATCH_PRESELECT_MIN_SCORE = 0.35;

// Deliberately close to "the same name after normalization" (which scores
// exactly 1): bigram similarity puts ordinary near-misses like "Tomatoes"
// vs "tomato" around 0.83, and a plural/singular slip is exactly the kind
// of thing that should still get a glance. Swedish receipts abbreviate
// names heavily, so in practice most fuzzy auto-accepts are exact-name
// hits and the barcode path does the rest. Tune against real receipts
// before loosening — a wrong auto-accept costs more than an extra look.
export const MATCH_AUTO_ACCEPT_MIN_SCORE = 0.9;

// Even a high score isn't confident when a second candidate is nearly as
// good — most often two items with the same name (a list with "Milk" on it
// twice, or inventory items "Mjölk" and "mjölk." that only differ in case
// and punctuation, which both score 1). Which one the user meant is a
// genuine choice, so the line stays open.
export const MATCH_AUTO_ACCEPT_MIN_MARGIN = 0.15;

export type InventoryMatchCandidate = { id: string; name: string };
export type InventoryMatch<T extends InventoryMatchCandidate> = T & { score: number };

/**
 * Scores every candidate against `name` and returns the top matches above
 * `minScore`, sorted best-first. Used to suggest existing inventory items
 * for a shopping-list item that didn't resolve via an exact name match.
 */
export function findInventoryMatches<T extends InventoryMatchCandidate>(
  name: string,
  candidates: T[],
  { limit = 5, minScore = 0.3 }: { limit?: number; minScore?: number } = {},
): InventoryMatch<T>[] {
  return candidates
    .map((candidate) => ({ ...candidate, score: itemNameSimilarity(name, candidate.name) }))
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
