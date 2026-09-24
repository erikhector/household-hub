// AUTO-3 — pure grouping/sort for "shopping mode": walk the store in a fixed
// produce → … → other order instead of insertion order. Dependency-free
// apart from the dictionaries (for the category label lookup below), so it's
// unit-testable without a DOM — the client component
// (src/components/shopping/shopping-list-client.tsx) only calls this and
// renders the result.
//
// A shopping-list item has no category of its own; the category lives on
// the linked InventoryItem (AUTO-2, src/lib/inventory/auto-category.ts) and
// is free text — either one of that file's `autoCategories` labels (stored
// in whichever locale was active when it was set), or a household's own
// custom category. AUTO-9 will let a household reorder/learn its own store
// layout; this wave's order is the fixed default baked into
// AUTO_CATEGORY_KEYS.

import { AUTO_CATEGORY_KEYS } from "@/lib/inventory/auto-category";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";

// Maps a category label's normalized text, in either locale, to its walk
// order — so "Dairy & eggs" and "Mejeri & ägg" (the same canonical category,
// just stored in different locales) both land in the same slot. Built once
// at module load, the same reverse-lookup shape category-resolver.ts's
// PLACEHOLDER_CATEGORIES uses for "Uncategorized".
const CATEGORY_ORDER = new Map<string, number>();
for (const [index, key] of AUTO_CATEGORY_KEYS.entries()) {
  for (const dict of [en, sv]) {
    CATEGORY_ORDER.set(dict.inventory.autoCategories[key].trim().toLowerCase(), index);
  }
}

// Every locale's "Uncategorized" placeholder, plus the English literal the
// shopping-list/inventory create paths have always written regardless of
// locale (see category-resolver.ts) — an item in any of these has no real
// category, same as one with no category at all.
const PLACEHOLDER_CATEGORIES = new Set(
  [en.inventory.uncategorized, sv.inventory.uncategorized, "Uncategorized"].map((c) => c.trim().toLowerCase()),
);

export type ShoppingModeGroup<T> = { label: string; items: T[] };

// Sort tier for a group: known categories (any AUTO_CATEGORY_KEYS label, in
// either locale) first, then a household's own custom category text, then
// "Other" last.
type Tier = 0 | 1 | 2;
type GroupEntry<T> = ShoppingModeGroup<T> & { tier: Tier; knownIndex: number };

/**
 * Groups items by their (linked inventory item's) category, in shopping-mode
 * order: any of AUTO_CATEGORY_KEYS' labels first, in that fixed produce → …
 * → household order — a category stored in either locale (e.g. "Dairy &
 * eggs" and "Mejeri & ägg") merges into the same group — then a household's
 * own custom category text, alphabetically; then `otherLabel` last, for
 * items with no category at all or still sitting in the "Uncategorized"
 * placeholder. Items keep their incoming relative order within a group
 * (list insertion order). Only categories actually present produce a group
 * — there's no empty "Frozen" header just because the key exists.
 */
export function groupPendingItemsByCategory<T extends { category: string | null }>(
  items: readonly T[],
  otherLabel: string,
): ShoppingModeGroup<T>[] {
  const groups = new Map<string, GroupEntry<T>>();
  for (const item of items) {
    const raw = item.category?.trim() ?? "";
    const normalized = raw.toLowerCase();
    const knownIndex = CATEGORY_ORDER.get(normalized);
    const isOther = raw === "" || PLACEHOLDER_CATEGORIES.has(normalized);

    // Known categories bucket by their canonical index rather than their
    // literal text, so the two locales' labels for the same category share
    // one group; "Other" is a single bucket; anything else (a custom
    // category) buckets by its own normalized text.
    const bucketKey = isOther ? "\0other" : knownIndex !== undefined ? `\0known-${knownIndex}` : normalized;

    let group = groups.get(bucketKey);
    if (!group) {
      group = {
        label: isOther ? otherLabel : raw,
        items: [],
        tier: isOther ? 2 : knownIndex !== undefined ? 0 : 1,
        knownIndex: knownIndex ?? 0,
      };
      groups.set(bucketKey, group);
    }
    group.items.push(item);
  }

  return [...groups.values()]
    .sort((a, b) => a.tier - b.tier || a.knownIndex - b.knownIndex || a.label.localeCompare(b.label))
    .map((group) => ({ label: group.label, items: group.items }));
}
