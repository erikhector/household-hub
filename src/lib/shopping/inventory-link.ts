import { createAliasLookup, type ItemAliasLike } from "@/lib/item-alias";
import { findInventoryMatches, type InventoryMatchCandidate } from "@/lib/item-matching";

// Only auto-link on a fuzzy match this confident — a typo or a trailing
// size/brand ("Milk 1L" vs "Milk") should still resolve automatically, but
// anything softer is safer left for the user to confirm via the edit dialog.
// Lives here rather than in shopping-list/item-actions.ts so every bulk path
// (import/paste there, GAP-4's templates in template-actions.ts) links with
// the exact same threshold — a "use server" file can't export a constant.
export const AUTO_FUZZY_MATCH_MIN_SCORE = 0.6;

/**
 * Builds a name → InventoryItem resolver over one household-wide inventory
 * fetch, for flows that link many rows at once (a pasted list, a template
 * expanding into a new list) and so shouldn't run a query per row. Exact
 * case-insensitive name first; then the household's learned alias for the
 * name (MATCH-5: "eggs" linked to Egg once in a recipe links the next pasted
 * "eggs" too); failing both, a fuzzy match only when exactly one candidate
 * clears AUTO_FUZZY_MATCH_MIN_SCORE — with two, guessing wrong is worse than
 * leaving the row unlinked ("needs mapping"). Never creates.
 *
 * An untracked alias (Don't track) isn't a link, and it doesn't stop the
 * fuzzy step either: it was a recipe answer ("no pantry item for water"),
 * not a statement about what a shopping row should link to, so the row gets
 * exactly the treatment it got before aliases existed. An alias whose item
 * isn't in `inventoryItems` is skipped the same way.
 */
export function createInventoryLinker<T extends InventoryMatchCandidate>(
  inventoryItems: T[],
  aliases: readonly ItemAliasLike[] = [],
) {
  const byExactName = new Map(inventoryItems.map((item) => [item.name.trim().toLowerCase(), item]));
  const byId = new Map(inventoryItems.map((item) => [item.id, item]));
  const aliasItemId = createAliasLookup(aliases);
  return (name: string): T | null => {
    const exact = byExactName.get(name.trim().toLowerCase());
    if (exact) return exact;
    const aliased = byId.get(aliasItemId(name) ?? "");
    if (aliased) return aliased;
    const matches = findInventoryMatches(name, inventoryItems, {
      minScore: AUTO_FUZZY_MATCH_MIN_SCORE,
      limit: 2,
    });
    return matches.length === 1 ? matches[0] : null;
  };
}
