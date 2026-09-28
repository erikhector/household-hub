// Where the item page (MATCH-6) was opened from, so its back arrow goes one
// step back instead of always to the inventory. Fixing a unit problem is a
// loop through the catalog's "Unit problems" filter: open an item, add the
// conversion, back to the list, next item. Sending that back arrow to the
// inventory made every round trip start over from "Manage items".
//
// The origin rides along as `?from=` on the item page's URL rather than
// relying on the browser history: the page is also opened from a fresh tab
// or a shared link, where there's no history to go back to, and a merge
// replaces the page with the kept item's (see merge-into-dialog.tsx), which
// should still know where it came from. Only these fixed values are
// accepted, so `from` can never become an open redirect.

import { parseCatalogFilter, type CatalogFilter } from "@/lib/inventory/catalog";

export type ItemPageOrigin =
  | { kind: "inventory" }
  | { kind: "catalog"; filter: CatalogFilter }
  | { kind: "recipes" };

const CATALOG_PREFIX = "catalog:";

/** The `from` value for an origin, or null for the inventory (the default,
 * so it needs no parameter). */
export function serializeItemPageOrigin(origin: ItemPageOrigin): string | null {
  switch (origin.kind) {
    case "inventory":
      return null;
    case "catalog":
      return origin.filter === "all" ? "catalog" : `${CATALOG_PREFIX}${origin.filter}`;
    case "recipes":
      return "recipes";
  }
}

/** Reads `?from=`. Anything unknown (or missing) falls back to the inventory. */
export function parseItemPageOrigin(value: unknown): ItemPageOrigin {
  const from = Array.isArray(value) ? value[0] : value;
  if (from === "recipes") return { kind: "recipes" };
  if (from === "catalog") return { kind: "catalog", filter: "all" };
  if (typeof from === "string" && from.startsWith(CATALOG_PREFIX)) {
    return { kind: "catalog", filter: parseCatalogFilter(from.slice(CATALOG_PREFIX.length)) };
  }
  return { kind: "inventory" };
}

/** The item page's URL, remembering where it was opened from. */
export function itemPageHref(itemId: string, origin: ItemPageOrigin = { kind: "inventory" }): string {
  const from = serializeItemPageOrigin(origin);
  const path = `/dashboard/inventory/items/${encodeURIComponent(itemId)}`;
  return from === null ? path : `${path}?from=${encodeURIComponent(from)}`;
}

/** Where the item page's back arrow goes. */
export function itemPageBackHref(origin: ItemPageOrigin): string {
  switch (origin.kind) {
    case "inventory":
      return "/dashboard/inventory";
    case "catalog":
      return catalogHref(origin.filter);
    case "recipes":
      return "/dashboard/meal-planning?tab=recipes";
  }
}

/** The catalog's URL on a given filter chip. */
export function catalogHref(filter: CatalogFilter): string {
  return filter === "all" ? "/dashboard/inventory/items" : `/dashboard/inventory/items?filter=${filter}`;
}
