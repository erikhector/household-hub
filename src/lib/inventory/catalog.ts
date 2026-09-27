// The item catalog's rows and filters (MATCH-7, design §6.2), built from a
// fixed set of household-wide query results (src/lib/inventory/
// catalog-data.ts), never one query per item. Pure, so the filters are
// tested without a database.

import { convertForItem, canonicalUnit, type ItemUnitConversionLike } from "@/lib/units";
import {
  findDuplicateGroups,
  isNeverStocked,
  type DuplicateAlias,
  type DuplicateDismissal,
  type DuplicateGroup,
  type DuplicateItem,
} from "@/lib/inventory/duplicates";

export const CATALOG_FILTERS = ["all", "duplicates", "neverStocked", "unitProblems"] as const;
export type CatalogFilter = (typeof CATALOG_FILTERS)[number];

export function parseCatalogFilter(value: unknown): CatalogFilter {
  return CATALOG_FILTERS.find((filter) => filter === value) ?? "all";
}

export type CatalogSourceItem = Omit<DuplicateItem, "purchasedListCount"> & { category: string };

export type CatalogRow = DuplicateItem & {
  category: string;
  neverStocked: boolean;
  /** Units a recipe uses this item in that neither the generic table nor
   * the item's conversions can turn into its own unit. */
  unitProblems: string[];
};

/** The recipe units `convertForItem` can't turn into the item's unit,
 * canonical and without repeats. */
export function unconvertibleUnits(
  item: { unit: string },
  recipeUnits: readonly string[],
  conversions: readonly ItemUnitConversionLike[],
): string[] {
  const units = new Set(recipeUnits.map(canonicalUnit));
  return [...units].filter((unit) => convertForItem(1, unit, item, conversions) === null);
}

export function buildCatalog({
  items,
  purchasedCounts,
  recipeUnits,
  conversions,
  aliases,
  dismissals,
}: {
  items: readonly CatalogSourceItem[];
  /** Ticked shopping-list rows per item id. */
  purchasedCounts: ReadonlyMap<string, number>;
  /** Distinct units each item is used in by recipes. */
  recipeUnits: readonly { inventoryItemId: string; unit: string }[];
  conversions: readonly (ItemUnitConversionLike & { inventoryItemId: string })[];
  aliases: readonly DuplicateAlias[];
  dismissals: readonly DuplicateDismissal[];
}): { rows: CatalogRow[]; groups: DuplicateGroup[] } {
  const unitsByItem = groupBy(recipeUnits, (row) => row.inventoryItemId);
  const conversionsByItem = groupBy(conversions, (row) => row.inventoryItemId);

  const rows = items
    .map((item) => {
      const full = { ...item, purchasedListCount: purchasedCounts.get(item.id) ?? 0 };
      return {
        ...full,
        neverStocked: isNeverStocked(full),
        unitProblems: unconvertibleUnits(
          item,
          (unitsByItem.get(item.id) ?? []).map((row) => row.unit),
          conversionsByItem.get(item.id) ?? [],
        ),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rows, groups: findDuplicateGroups(rows, aliases, dismissals) };
}

/** The rows a chip shows (the duplicates chip shows groups instead). */
export function filterCatalogRows(rows: readonly CatalogRow[], filter: Exclude<CatalogFilter, "duplicates">): CatalogRow[] {
  if (filter === "neverStocked") return rows.filter((row) => row.neverStocked);
  if (filter === "unitProblems") return rows.filter((row) => row.unitProblems.length > 0);
  return [...rows];
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list) list.push(row);
    else map.set(key(row), [row]);
  }
  return map;
}
