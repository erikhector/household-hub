// Learned item names (ItemAlias, MATCH-2) outside the recipe matcher
// (MATCH-5, design docs/archive/RECIPE_INGREDIENT_MATCHING.md §3.5): the
// shopping-list linker (import, templates, smart-add, the recipe → list
// bridge), the receipt matcher and ResolveMappingsDialog all read the same
// rows, and a shopping-list row the user links by hand teaches one the same
// way the recipe review does. Fixing "eggs → Egg" once then fixes it
// everywhere.
//
// The lookup is pure (the callers load the household's aliases once per
// request, next to the inventory query they already run, and pass them in),
// so it runs in the client dialogs too. The only import from Prisma is a
// type, erased at build time.

import { normalizeItemName } from "@/lib/item-matching";
import type { Prisma } from "@/generated/prisma/client";

/** An ItemAlias row as the matchers need it: `normalizedName` means that
 * item, or, with a null `inventoryItemId`, "never tracked". */
export type ItemAliasLike = { normalizedName: string; inventoryItemId: string | null };

/**
 * name → the item a learned alias links it to, or null. Only tracked
 * aliases count here: an untracked one ("water", Don't track) is a recipe
 * answer that says nothing about which item a shopping or receipt row is,
 * so it links nothing and doesn't stop the caller's own fuzzy match
 * either. Keyed by normalizeItemName, exactly as the aliases were written.
 */
export function createAliasLookup(aliases: readonly ItemAliasLike[]): (name: string) => string | null {
  const byName = new Map<string, string>();
  for (const alias of aliases) {
    if (alias.inventoryItemId) byName.set(alias.normalizedName, alias.inventoryItemId);
  }
  return (name) => byName.get(normalizeItemName(name)) ?? null;
}

/**
 * Remembers that `name` means `inventoryItemId` for the household, the way
 * the recipe review does (createIngredientItems in
 * meal-planning/recipe-actions.ts): replaced, not added to, so the latest
 * answer wins, and one upsert (INSERT … ON CONFLICT) so two saves teaching
 * the same name at once can't both insert and fail on the unique index.
 * Nothing is written when the name already normalizes to the item's own
 * name, since the exact match finds it anyway. The caller has checked that
 * the item is the household's.
 */
export async function learnItemAlias(
  db: Pick<Prisma.TransactionClient, "itemAlias">,
  householdId: string,
  name: string,
  item: { id: string; name: string },
): Promise<void> {
  const normalizedName = normalizeItemName(name);
  if (!normalizedName || normalizedName === normalizeItemName(item.name)) return;
  await db.itemAlias.upsert({
    where: { householdId_normalizedName: { householdId, normalizedName } },
    create: { householdId, normalizedName, inventoryItemId: item.id },
    update: { inventoryItemId: item.id },
  });
}
