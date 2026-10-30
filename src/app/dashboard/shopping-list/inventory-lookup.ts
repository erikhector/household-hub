// MAINT-3: inventory-matching helpers the item and receipt actions share.
// A plain server module on purpose: they take a household id, so they must
// not live in a "use server" file, where every export is a client-callable
// endpoint (see src/lib/use-server-exports.test.ts).

import { prisma } from "@/lib/prisma";
import { findInventoryMatches } from "@/lib/item-matching";
import { AUTO_FUZZY_MATCH_MIN_SCORE } from "@/lib/shopping/inventory-link";
import type { InventoryItem } from "@/generated/prisma/client";

/**
 * Case-insensitive exact-name lookup only — never creates. Used wherever a
 * shopping-list item should be auto-linked when it obviously already
 * matches something in inventory, but left unlinked (rather than spawning a
 * near-duplicate item) when it doesn't; the user then resolves it via
 * linkShoppingListItemAction/createInventoryItemFromShoppingListItemAction
 * (item-actions.ts; see ShoppingItemFormDialog's edit mode).
 */
export async function findExactInventoryItem(householdId: string, name: string) {
  return prisma.inventoryItem.findFirst({
    where: { householdId, name: { equals: name, mode: "insensitive" } },
  });
}

/**
 * Fuzzy fallback for findExactInventoryItem, used only when there's no exact
 * match: auto-links a new shopping-list item to an existing inventory item
 * when exactly one candidate scores above AUTO_FUZZY_MATCH_MIN_SCORE. With
 * two candidates both scoring above it, guessing wrong is worse than leaving
 * the item unlinked, so that case is left alone too.
 *
 * A batch caller (registerReceiptAction) passes the household's items as
 * `preloaded` so N unmatched lines cost one table read, not N.
 */
export async function findFuzzyInventoryItem(householdId: string, name: string, preloaded?: InventoryItem[]) {
  const candidates = preloaded ?? (await prisma.inventoryItem.findMany({ where: { householdId } }));
  const matches = findInventoryMatches(name, candidates, { minScore: AUTO_FUZZY_MATCH_MIN_SCORE, limit: 2 });
  return matches.length === 1 ? matches[0] : null;
}
