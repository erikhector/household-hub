import { findInventoryMatches, type InventoryMatchCandidate } from "@/lib/item-matching";

// Only auto-link on a fuzzy match this confident — a typo or a trailing
// size/brand ("Milk 1L" vs "Milk") should still resolve automatically, but
// anything softer is safer left for the user to confirm via the edit dialog.
// Lives here rather than in shopping-list/actions.ts so every bulk path
// (import/paste there, GAP-4's templates in template-actions.ts) links with
// the exact same threshold — a "use server" file can't export a constant.
export const AUTO_FUZZY_MATCH_MIN_SCORE = 0.6;

/**
 * Builds a name → InventoryItem resolver over one household-wide inventory
 * fetch, for flows that link many rows at once (a pasted list, a template
 * expanding into a new list) and so shouldn't run a query per row. Exact
 * case-insensitive name first; failing that, a fuzzy match only when exactly
 * one candidate clears AUTO_FUZZY_MATCH_MIN_SCORE — with two, guessing wrong
 * is worse than leaving the row unlinked ("needs mapping"). Never creates.
 */
export function createInventoryLinker<T extends InventoryMatchCandidate>(inventoryItems: T[]) {
  const byExactName = new Map(inventoryItems.map((item) => [item.name.trim().toLowerCase(), item]));
  return (name: string): T | null => {
    const exact = byExactName.get(name.trim().toLowerCase());
    if (exact) return exact;
    const matches = findInventoryMatches(name, inventoryItems, {
      minScore: AUTO_FUZZY_MATCH_MIN_SCORE,
      limit: 2,
    });
    return matches.length === 1 ? matches[0] : null;
  };
}
