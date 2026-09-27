import { prisma } from "@/lib/prisma";
import { buildCatalog } from "@/lib/inventory/catalog";
import { findDuplicateGroups } from "@/lib/inventory/duplicates";

// The item catalog's data (MATCH-7, design §6.2): six household-scoped
// queries run together whatever the number of items (PERF-1 style), then
// the pure buildCatalog. Callers have already resolved the household from
// the session.
export async function loadCatalog(householdId: string) {
  const [items, purchased, recipeUnits, conversions, aliases, dismissals] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { householdId },
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        quantity: true,
        createdAt: true,
        barcode: true,
        _count: {
          select: { recipeIngredients: true, shoppingListItems: true, listTemplateItems: true, priceHistory: true },
        },
      },
    }),
    prisma.shoppingListItem.groupBy({
      by: ["inventoryItemId"],
      where: { purchased: true, inventoryItemId: { not: null }, shoppingList: { householdId } },
      _count: { _all: true },
    }),
    prisma.recipeIngredient.findMany({
      where: { inventoryItemId: { not: null }, recipe: { householdId } },
      select: { inventoryItemId: true, unit: true },
      distinct: ["inventoryItemId", "unit"],
    }),
    prisma.itemUnitConversion.findMany({
      where: { inventoryItem: { householdId } },
      select: { inventoryItemId: true, fromUnit: true, factor: true },
    }),
    duplicateAliases(householdId),
    duplicateDismissals(householdId),
  ]);

  return buildCatalog({
    items: items.map(({ _count, ...item }) => ({
      ...item,
      recipeCount: _count.recipeIngredients,
      listCount: _count.shoppingListItems,
      templateCount: _count.listTemplateItems,
      priceCount: _count.priceHistory,
    })),
    purchasedCounts: new Map(purchased.map((row) => [row.inventoryItemId!, row._count._all])),
    recipeUnits: recipeUnits.map((row) => ({ inventoryItemId: row.inventoryItemId!, unit: row.unit })),
    conversions,
    aliases,
    dismissals,
  });
}

/**
 * How many open duplicate groups the household has, for the inventory
 * page's "Manage items" badge. Takes the items that page already loaded,
 * so it adds only the alias and dismissal queries. Which member would be
 * kept doesn't change the number of groups, so the history counts that
 * only order the members are left at zero.
 */
export async function countDuplicateGroups(
  householdId: string,
  items: readonly { id: string; name: string; unit: string; quantity: number; createdAt: Date; barcode: string | null }[],
): Promise<number> {
  const [aliases, dismissals] = await Promise.all([duplicateAliases(householdId), duplicateDismissals(householdId)]);
  const counted = items.map((item) => ({
    ...item,
    recipeCount: 0,
    listCount: 0,
    templateCount: 0,
    priceCount: 0,
    purchasedListCount: 0,
  }));
  return findDuplicateGroups(counted, aliases, dismissals).length;
}

function duplicateAliases(householdId: string) {
  return prisma.itemAlias.findMany({
    where: { householdId, inventoryItemId: { not: null } },
    select: { normalizedName: true, inventoryItemId: true },
  });
}

function duplicateDismissals(householdId: string) {
  return prisma.inventoryDuplicateDismissal.findMany({
    where: { householdId },
    select: { itemAId: true, itemBId: true },
  });
}
