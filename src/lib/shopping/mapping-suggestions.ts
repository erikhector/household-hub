// What ResolveMappingsDialog suggests for one unlinked shopping-list row:
// the items listed first in its picker, and the one pre-selected. Pure, so
// the ranking is unit-tested without rendering the dialog.

import { createAliasLookup, type ItemAliasLike } from "@/lib/item-alias";
import { findInventoryMatches, MATCH_PRESELECT_MIN_SCORE, type InventoryMatchCandidate } from "@/lib/item-matching";

/**
 * The household's learned alias for the name (MATCH-5) is the pre-selected
 * suggestion and heads the list: it's the household's own earlier answer,
 * so it beats any fuzzy guess. Otherwise the fuzzy ranking, pre-selecting
 * the best match above MATCH_PRESELECT_MIN_SCORE, as before aliases. An
 * untracked alias, or one whose item is gone, is ignored.
 */
export function mappingSuggestions<T extends InventoryMatchCandidate>(
  name: string,
  inventoryItems: T[],
  aliases: readonly ItemAliasLike[] = [],
): { suggestions: T[]; preselectedId: string | null } {
  const aliasItemId = createAliasLookup(aliases)(name);
  const aliased = aliasItemId ? inventoryItems.find((item) => item.id === aliasItemId) : undefined;
  const fuzzy = findInventoryMatches(name, inventoryItems);
  const byId = new Map(inventoryItems.map((item) => [item.id, item]));
  // findInventoryMatches returns copies with a score; the picker wants the
  // items themselves.
  const ranked = fuzzy.map((match) => byId.get(match.id)!).filter((item) => item !== aliased);
  const preselected = aliased ?? (fuzzy[0] && fuzzy[0].score >= MATCH_PRESELECT_MIN_SCORE ? fuzzy[0] : undefined);
  return { suggestions: aliased ? [aliased, ...ranked] : ranked, preselectedId: preselected?.id ?? null };
}
