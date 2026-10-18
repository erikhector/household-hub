import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { getStockStatus, type StockStatus } from "@/lib/stock-status";
import { getExpiryStatus } from "@/lib/inventory/expiry";

// Sentinel values InventoryClient's filter selects use for "no filter
// applied" / "no location set", shared here so parseInventoryViewPrefs below
// can recognize them as always-valid without importing a "use client" module.
export const ALL_FILTER = "__all__";
export const UNASSIGNED_LOCATION = "__unassigned__";

export type InventoryItemRow = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  location: string | null;
  expiresAt: Date | null;
  // AUTO-7: whether `expiresAt` is a shelf-life estimate rather than a
  // typed-in date — see ExpiryBadge's own doc comment.
  expiresAtEstimated: boolean;
  shelfLifeDays: number | null;
  // GAP-28: when the pack was marked opened (shows ExpiryBadge's "Opened"
  // tag), and the per-item "use within N days once opened" window that
  // gates the row's "Mark opened" button — see InventoryItem in
  // schema.prisma.
  openedAt: Date | null;
  useWithinDaysOpened: number | null;
  // GAP-44: when the item was frozen (shows ExpiryBadge's "Frozen" tag and
  // hides the row's "Freeze" button) and its optional freezer window.
  frozenAt: Date | null;
  useWithinDaysFrozen: number | null;
  updatedAt: Date;
  updatedByUserId: string | null;
  // Ticked off a shopping list but not put away yet (src/lib/incoming-stock.ts)
  // — shown as a "+N on the way" hint beside the stock badge. The badge
  // itself stays on `quantity`: it isn't home yet. Absent or 0 = none.
  incoming?: number;
  // UX-122: a row still to buy sits on an active shopping list — shows the
  // "On list" tag. Absent = not on one.
  onList?: boolean;
};

export type HouseholdMemberOption = { userId: string; displayName: string };

export type InventoryGroupBy = "none" | "category" | "location" | "both";

// Bucketed "last updated" ranges the filter dropdown offers — see
// matchesUpdatedFilter below. Kept as a plain union (not derived from the
// dict) so InventoryClient's filtering logic doesn't depend on translations.
export type UpdatedFilter = "all" | "today" | "week" | "stale30" | "stale90";

// The inventory view's grouping + filter selections, persisted to
// User.inventoryViewPrefs (src/lib/actions/preferences.ts) so they survive
// reloads and follow the account across devices. category/location are
// free-text (they mirror whatever categories/locations the household has
// actually used) or ALL_FILTER/UNASSIGNED_LOCATION; InventoryClient discards
// a saved category/location that's no longer in the household's current list.
export type InventoryViewPrefs = {
  groupBy: InventoryGroupBy;
  category: string;
  location: string;
  status: string;
  updatedFilter: UpdatedFilter;
};

const GROUP_BY_VALUES = new Set<InventoryGroupBy>(["none", "category", "location", "both"]);
const UPDATED_FILTER_VALUES = new Set<UpdatedFilter>(["all", "today", "week", "stale30", "stale90"]);
// UX-121: the Status filter covers expiry too, so "expiring" (inside the
// warning window) and "expired" sit beside the three stock statuses.
export type InventoryStatusFilter = StockStatus | "expiring" | "expired";

const STATUS_VALUES = new Set<InventoryStatusFilter>(["in", "low", "out", "expiring", "expired"]);

// Reads back whatever's in User.inventoryViewPrefs (untyped JSON — could be
// null, stale from a schema change, or missing fields) and keeps only the
// fields that still parse as a known value, so a corrupt/outdated row can
// never crash the inventory page. Fields it drops fall back to
// InventoryClient's own defaults.
export function parseInventoryViewPrefs(value: unknown): Partial<InventoryViewPrefs> {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const prefs: Partial<InventoryViewPrefs> = {};

  if (typeof v.groupBy === "string" && GROUP_BY_VALUES.has(v.groupBy as InventoryGroupBy)) {
    prefs.groupBy = v.groupBy as InventoryGroupBy;
  }
  if (typeof v.category === "string") prefs.category = v.category;
  if (typeof v.location === "string") prefs.location = v.location;
  if (typeof v.status === "string" && (v.status === ALL_FILTER || STATUS_VALUES.has(v.status as InventoryStatusFilter))) {
    prefs.status = v.status;
  }
  if (typeof v.updatedFilter === "string" && UPDATED_FILTER_VALUES.has(v.updatedFilter as UpdatedFilter)) {
    prefs.updatedFilter = v.updatedFilter as UpdatedFilter;
  }

  return prefs;
}

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

/** UX-121: whether an item belongs under a Status filter value. The stock
 * statuses and the expiry ones are independent: a low item can also be
 * expiring, and shows under both. */
export function matchesStatusFilter(
  item: Pick<InventoryItemRow, "quantity" | "lowStockThreshold" | "expiresAt">,
  filter: InventoryStatusFilter,
  now: number,
): boolean {
  if (filter === "expiring") return getExpiryStatus(item.expiresAt, now) === "soon";
  if (filter === "expired") return getExpiryStatus(item.expiresAt, now) === "expired";
  return getStockStatus(item.quantity, item.lowStockThreshold) === filter;
}

/** UX-121: the counts the inventory header shows, one per problem status. */
export function countProblemStatuses(
  items: Pick<InventoryItemRow, "quantity" | "lowStockThreshold" | "expiresAt">[],
  now: number,
): Record<"out" | "low" | "expiring" | "expired", number> {
  const counts = { out: 0, low: 0, expiring: 0, expired: 0 };
  for (const item of items) {
    const stock = getStockStatus(item.quantity, item.lowStockThreshold);
    if (stock === "out" || stock === "low") counts[stock] += 1;
    const expiry = getExpiryStatus(item.expiresAt, now);
    if (expiry === "soon") counts.expiring += 1;
    else if (expiry === "expired") counts.expired += 1;
  }
  return counts;
}
