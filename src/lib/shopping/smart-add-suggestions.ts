// Pure half of the shopping list's smart add line (AUTO-1, see
// src/components/shopping/smart-add-bar.tsx): which inventory items to
// suggest as the user types, in what order, and how the typed text becomes
// the rows smartAddShoppingListItemsAction commits. Dependency-free apart
// from the shared parser/normalizer, so it runs in the client bar and is
// unit-tested without a DOM — and so voice input (AUTO-12) feeds
// its transcript through exactly the same parse → rows path.

import { parsePastedList, type ParsedItem } from "@/lib/inventory/parse-pasted-list";
import { createAliasLookup, type ItemAliasLike } from "@/lib/item-alias";
import { findInventoryMatches, normalizeItemName, type InventoryMatchCandidate } from "@/lib/item-matching";
import type { StockStatus } from "@/lib/stock-status";

export type SmartAddCandidate = {
  id: string;
  name: string;
  unit: string;
  stockStatus: StockStatus;
  /** When this item was last bought off any of the household's lists (ms
   * since epoch), or null if it never has been. */
  lastPurchasedAt: number | null;
};

// The three tiers from the AUTO-1 brief, in the order they're shown: what
// the household is actually short of first (the likeliest reason to be
// typing it), then its regular buys, then the rest of the pantry.
function tier(candidate: SmartAddCandidate): number {
  if (candidate.stockStatus !== "in") return 0;
  if (candidate.lastPurchasedAt !== null) return 1;
  return 2;
}

// -1 = the name *is* the query, 0 = the whole name starts with it, 1 = some
// later word does,
// 2 = it's somewhere mid-word ("mjölk" inside "havremjölk" — Swedish
// compounds put the head noun last, so this is worth keeping), null = no
// match at all.
function matchQuality(normalizedName: string, query: string): number | null {
  if (normalizedName === query) return -1;
  if (normalizedName.startsWith(query)) return 0;
  if (normalizedName.includes(` ${query}`)) return 1;
  if (normalizedName.includes(query)) return 2;
  return null;
}

/**
 * Ranks the candidates whose name contains `query` (case-, accent-form- and
 * punctuation-insensitive, via normalizeItemName). An item whose name is
 * exactly the query always comes first — it's what's being typed, whatever
 * its stock. The rest go low/out-of-stock items first, then previously
 * bought items, then everything else. Within a tier a
 * name that starts with the query beats one that only contains it (typing
 * "mjöl" is likelier to mean Mjöl than Havremjölk, however recently the oat
 * milk was bought), then the more recently bought wins, then the name.
 * Candidates in `excludeIds` (already pending on this list) are dropped —
 * suggesting them would only lead to the "already on the list" hint. An
 * empty query suggests nothing: the dropdown only opens once the user has
 * started typing.
 */
export function rankSmartAddSuggestions(
  query: string,
  candidates: SmartAddCandidate[],
  { limit = 6, excludeIds }: { limit?: number; excludeIds?: ReadonlySet<string> } = {},
): SmartAddCandidate[] {
  const normalizedQuery = normalizeItemName(query);
  if (!normalizedQuery) return [];

  return candidates
    .filter((candidate) => !excludeIds?.has(candidate.id))
    .map((candidate) => ({ candidate, quality: matchQuality(normalizeItemName(candidate.name), normalizedQuery) }))
    .filter((entry): entry is { candidate: SmartAddCandidate; quality: number } => entry.quality !== null)
    .sort(
      (a, b) =>
        Number(b.quality === -1) - Number(a.quality === -1) ||
        tier(a.candidate) - tier(b.candidate) ||
        a.quality - b.quality ||
        (b.candidate.lastPurchasedAt ?? 0) - (a.candidate.lastPurchasedAt ?? 0) ||
        a.candidate.name.localeCompare(b.candidate.name),
    )
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/**
 * One row for smartAddShoppingListItemsAction. `unit` is left out when the
 * user didn't type one, so the server can use the linked item's usual unit
 * ("mjölk" → litres, if that's how the pantry counts milk) instead of
 * parsePastedList's "pcs" default. `inventoryItemId` is set only when the
 * row came from picking a suggestion.
 */
export type SmartAddRow = { name: string; quantity: number; unit?: string; inventoryItemId?: string };

// parsePastedList falls back to "pcs" when no unit word was found, so "pcs"
// here means "no unit typed" (an explicit "2 pcs milk" is indistinguishable,
// and treating it as the item's usual unit is harmless).
function toRow(item: ParsedItem): SmartAddRow {
  return item.unit === "pcs"
    ? { name: item.name, quantity: item.quantity }
    : { name: item.name, quantity: item.quantity, unit: item.unit };
}

/** "2 l mjölk, bröd, 6 ägg" → three rows, through the shared parser. */
export function parseSmartAddInput(input: string): SmartAddRow[] {
  return parsePastedList(input).map(toRow);
}

/**
 * Splits the input at its last comma/newline: everything before it is
 * already-finished items, and the segment being typed is what the dropdown
 * should autocomplete. The segment is parsed too, so "2 l mj" suggests for
 * "mj" and picking a suggestion keeps the "2 l".
 */
export function splitSmartAddInput(input: string): { head: string; current: ParsedItem | null } {
  const cut = Math.max(input.lastIndexOf(","), input.lastIndexOf("\n"));
  const head = cut === -1 ? "" : input.slice(0, cut);
  const current = parsePastedList(input.slice(cut + 1))[0] ?? null;
  return { head, current };
}

/**
 * The rows for picking `suggestion` while typing `input`: every finished
 * item before the current segment, plus the suggestion itself linked by id
 * and carrying whatever quantity/unit was typed in front of it (else 1 of
 * its usual unit).
 */
export function rowsForSuggestion(input: string, suggestion: SmartAddCandidate): SmartAddRow[] {
  const { head, current } = splitSmartAddInput(input);
  const typed = current ? toRow(current) : null;
  return [
    ...parseSmartAddInput(head),
    {
      name: suggestion.name,
      quantity: typed?.quantity ?? 1,
      unit: typed?.unit ?? suggestion.unit,
      inventoryItemId: suggestion.id,
    },
  ];
}

// Stricter than the shopping list's usual AUTO_FUZZY_MATCH_MIN_SCORE (0.6,
// actions.ts): the smart add line never leaves a row unlinked, so a fuzzy
// match accepted here is a silent link rather than a suggestion the user
// confirms. 0.8 is the bar AUTO-2's household memory uses (auto-category.ts).
export const SMART_ADD_FUZZY_MIN_SCORE = 0.8;

/**
 * Which existing inventory item a typed smart-add name means, or null to
 * create a new one — cheapest and surest first:
 *
 *   1. the same name, normalized ("mjölk" = "Mjölk");
 *   1b. the household's learned alias for the name (MATCH-5: "eggs" once
 *      linked to Egg in a recipe or a shopping list). An untracked alias
 *      isn't a link and doesn't stop the steps below;
 *   2. the one item that is the typed words plus only size/strength tokens
 *      (any word with a digit: "mjölk" → "Mjölk 3%", "milk" → "Milk 1L"),
 *      so a variant converges on the item the household already has.
 *      Checked before the fuzzy score because bigram overlap can't tell a
 *      size suffix from a different word — "Mjöl" (flour) scores higher
 *      against "mjölk" than "Mjölk 3%" does. Extra *words* don't count:
 *      "milk" must not become "Milk chocolate";
 *   3. the one item scoring at least SMART_ADD_FUZZY_MIN_SCORE on
 *      findInventoryMatches (typos, plurals: "tomatos" → "Tomatoes").
 *
 * Two plausible items at step 2 or 3 is a tie, and a tie creates rather
 * than guesses. Known gap: with only "Mjölk" in the pantry, "mjöl" still
 * clears step 3 — the autocomplete (which shows "Mjölk" as you type) and the
 * row's edit dialog are the ways out.
 */
export function matchSmartAddInventoryItem<T extends InventoryMatchCandidate>(
  name: string,
  candidates: T[],
  aliases: readonly ItemAliasLike[] = [],
): T | null {
  const normalized = normalizeItemName(name);
  if (!normalized) return null;

  const exact = candidates.find((candidate) => normalizeItemName(candidate.name) === normalized);
  if (exact) return exact;

  const aliasItemId = createAliasLookup(aliases)(name);
  const aliased = aliasItemId ? candidates.find((candidate) => candidate.id === aliasItemId) : undefined;
  if (aliased) return aliased;

  const typedWords = new Set(normalized.split(" "));
  const byWords = candidates.filter((candidate) => {
    const words = normalizeItemName(candidate.name).split(" ");
    return (
      [...typedWords].every((word) => words.includes(word)) &&
      words.every((word) => typedWords.has(word) || /\d/.test(word))
    );
  });
  if (byWords.length === 1) return byWords[0];
  if (byWords.length > 1) return null;

  const fuzzy = findInventoryMatches(name, candidates, { minScore: SMART_ADD_FUZZY_MIN_SCORE, limit: 2 });
  return fuzzy.length === 1 ? fuzzy[0] : null;
}
