import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type InventoryItemRow = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  location: string | null;
  updatedAt: Date;
  updatedByUserId: string | null;
};

export type HouseholdMemberOption = { userId: string; displayName: string };

export type InventoryGroupBy = "none" | "category" | "location" | "both";

// Bucketed "last updated" ranges the filter dropdown offers — see
// matchesUpdatedFilter below. Kept as a plain union (not derived from the
// dict) so InventoryClient's filtering logic doesn't depend on translations.
export type UpdatedFilter = "all" | "today" | "week" | "stale30" | "stale90";

const DAY_MS = 24 * 60 * 60 * 1000;

export function matchesUpdatedFilter(item: InventoryItemRow, filter: UpdatedFilter, now: number): boolean {
  const ageMs = now - item.updatedAt.getTime();
  switch (filter) {
    case "today":
      return ageMs < DAY_MS;
    case "week":
      return ageMs < 7 * DAY_MS;
    case "stale30":
      return ageMs >= 30 * DAY_MS;
    case "stale90":
      return ageMs >= 90 * DAY_MS;
    default:
      return true;
  }
}

export function groupKeyFor(item: InventoryItemRow, groupBy: InventoryGroupBy, dict: Dictionary["inventory"]) {
  const location = item.location || dict.noLocation;
  if (groupBy === "category") return item.category;
  if (groupBy === "location") return location;
  if (groupBy === "both") return `${item.category} • ${location}`;
  return "";
}

// Groups items by the chosen key while keeping each group's items in their
// incoming order (already name-sorted by the server/filter). Groups
// themselves are sorted alphabetically so the table stays scannable no
// matter which grouping is picked.
export function groupItems(items: InventoryItemRow[], groupBy: InventoryGroupBy, dict: Dictionary["inventory"]) {
  if (groupBy === "none") return [{ key: "", items }];

  const groups = new Map<string, InventoryItemRow[]>();
  for (const item of items) {
    const key = groupKeyFor(item, groupBy, dict);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, groupedItems]) => ({ key, items: groupedItems }));
}
