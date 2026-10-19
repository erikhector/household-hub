// AUTO-3 — pure grouping/sort for "shopping mode": walk the store in
// category order instead of insertion order. Dependency-free apart from
// category-labels.ts (for the category label lookup below) and
// store-order.ts, so it's unit-testable without a DOM — the client
// component (src/components/shopping/shopping-list-client.tsx) only calls
// this and renders the result.
//
// PERF-6: this module is reachable from that client component, so it
// imports only category-labels.ts's small label lookup rather than the
// full `en`/`sv` dictionaries (which used to double the shopping-list
// route's client bundle by ~68 KB gz for text this file never renders).
//
// A shopping-list item has no category of its own; the category lives on
// the linked InventoryItem (AUTO-2, src/lib/inventory/auto-category.ts) and
// is free text — either one of that file's `autoCategories` labels (stored
// in whichever locale was active when it was set), or a household's own
// custom category. AUTO_CATEGORY_KEYS' order is only the starting guess:
// AUTO-9 (store-order.ts) learns a household's own walk order from its
// check-offs and lets it arrange the groups by hand, and this sorts by
// whatever that says.

import { AUTO_CATEGORY_KEYS, type AutoCategoryKey } from "@/lib/inventory/auto-category";
import { categoryLabels } from "@/lib/inventory/category-labels";
import {
  compareCategoryKeys,
  EMPTY_STORE_ORDER,
  KNOWN_CATEGORY_KEY_PREFIX,
  type StoreOrder,
} from "@/lib/shopping/store-order";

// Maps a category label's normalized text, in either locale, to its
// category key (store-order.ts) — so "Dairy & eggs" and "Mejeri & ägg" (the
// same canonical category, just stored in different locales) land in the
// same group and learn as one. Built once at module load, the same
// reverse-lookup shape category-resolver.ts's PLACEHOLDER_CATEGORIES uses
// for "Uncategorized".
const KNOWN_CATEGORY_KEYS = new Map<string, string>();
for (const key of AUTO_CATEGORY_KEYS) {
  for (const labels of [categoryLabels.en, categoryLabels.sv]) {
    KNOWN_CATEGORY_KEYS.set(
      labels.autoCategories[key].trim().toLowerCase(),
      `${KNOWN_CATEGORY_KEY_PREFIX}${key}`,
    );
  }
}

// Every locale's "Uncategorized" placeholder, plus the English literal the
// shopping-list/inventory create paths have always written regardless of
// locale (see category-resolver.ts) — an item in any of these has no real
// category, same as one with no category at all.
const PLACEHOLDER_CATEGORIES = new Set(
  [categoryLabels.en.uncategorized, categoryLabels.sv.uncategorized, "Uncategorized"].map((c) =>
    c.trim().toLowerCase(),
  ),
);

/**
 * The stable identity AUTO-9 learns and stores a category under:
 * "auto:<key>" for any AUTO_CATEGORY_KEYS label in either locale, the
 * trimmed, lower-cased text for a household's own category, and null for
 * "Other" (no category, blank, or the "Uncategorized" placeholder), which
 * has no place in the store to learn.
 */
export function categoryKey(category: string | null): string | null {
  const normalized = category?.trim().toLowerCase() ?? "";
  if (normalized === "" || PLACEHOLDER_CATEGORIES.has(normalized)) return null;
  return KNOWN_CATEGORY_KEYS.get(normalized) ?? normalized;
}

function groupLabel(key: string, stored: string | null, locale?: keyof typeof categoryLabels): string {
  if (locale && key.startsWith(KNOWN_CATEGORY_KEY_PREFIX)) {
    const label = categoryLabels[locale].autoCategories[key.slice(KNOWN_CATEGORY_KEY_PREFIX.length) as AutoCategoryKey];
    if (label) return label;
  }
  return (stored ?? "").trim();
}

/** `key` is the group's category key (see categoryKey); null for "Other". */
export type ShoppingModeGroup<T> = { key: string | null; label: string; items: T[] };

/**
 * Groups items by their (linked inventory item's) category, in shopping-mode
 * order: the household's store order (AUTO-9, store-order.ts's
 * compareCategoryKeys — a hand-arranged order first, then learned
 * positions, then AUTO_CATEGORY_KEYS' fixed produce → … → household
 * default, with a household's own custom categories after the known ones,
 * alphabetically, until anything's been learned about them), then
 * `otherLabel` last, for items with no category at all or still sitting in
 * the "Uncategorized" placeholder. A category stored in either locale (e.g.
 * "Dairy & eggs" and "Mejeri & ägg") merges into the same group. Items keep
 * their incoming relative order within a group (list insertion order). Only
 * categories actually present produce a group — there's no empty "Frozen"
 * header just because the key exists. With no `order` (or an empty one)
 * this is exactly AUTO-3's fixed order. A known category's label comes from
 * `locale`'s category labels when given (UX-83).
 */
export function groupPendingItemsByCategory<T extends { category: string | null }>(
  items: readonly T[],
  otherLabel: string,
  order: StoreOrder = EMPTY_STORE_ORDER,
  locale?: keyof typeof categoryLabels,
): ShoppingModeGroup<T>[] {
  // Keyed by category key, with "Other" under "" — a real key is never
  // empty, so the two can't collide.
  const groups = new Map<string, ShoppingModeGroup<T>>();
  for (const item of items) {
    const key = categoryKey(item.category);
    let group = groups.get(key ?? "");
    if (!group) {
      // UX-83: a known category is labelled in the viewer's `locale`, not in
      // whichever locale the first item happened to be stored in (a Swedish
      // session otherwise saw "PRODUCE" next to "ÖVRIGT"). A household's own
      // category has no translation, so it keeps its stored text; so does
      // everything when no `locale` is given.
      group = { key, label: key === null ? otherLabel : groupLabel(key, item.category, locale), items: [] };
      groups.set(key ?? "", group);
    }
    group.items.push(item);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === null || b.key === null) return Number(a.key === null) - Number(b.key === null);
    return compareCategoryKeys(a.key, b.key, order);
  });
}
