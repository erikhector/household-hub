// UX-37 — the pure half of shopping mode's "tool" layer: how far through
// the list a trip is (the progress ring's "12 of 18") and what the
// thumb-zone "Next up" dock offers to tick (the first few items of the
// aisle the shopper is in now). Dependency-free so it's unit-testable
// without a DOM; src/components/shopping/shopping-mode.tsx renders it.

import type { ShoppingModeGroup } from "@/lib/shopping/shopping-mode-grouping";

/** How many of the current aisle's items the dock shows at once. Three
 * full-height rows plus the ring fit the lower third of a 412 px phone
 * without hiding most of the list behind the dock. */
export const NEXT_UP_LIMIT = 3;

export type ShoppingProgress = { done: number; total: number; fraction: number };

/** Ticked rows over all rows. An empty list is 0 of 0 at fraction 0 (the
 * ring stays empty rather than dividing by zero into NaN). */
export function shoppingProgress(items: readonly { purchased: boolean }[]): ShoppingProgress {
  const total = items.length;
  const done = items.filter((item) => item.purchased).length;
  return { done, total, fraction: total === 0 ? 0 : done / total };
}

export type NextUp<T> = { key: string | null; label: string; items: T[]; more: number };

/**
 * The aisle the shopper is in now: the first pending group in store order
 * (groupPendingItemsByCategory's output), its first `limit` items in list
 * order, and how many more of that aisle are waiting below. Ticking those
 * moves the next one up, and finishing the aisle brings the next aisle's
 * items into the dock, so a whole trip can be ticked off from there. null
 * when nothing is pending.
 */
export function nextUp<T>(groups: readonly ShoppingModeGroup<T>[], limit = NEXT_UP_LIMIT): NextUp<T> | null {
  const group = groups.find((g) => g.items.length > 0);
  if (!group) return null;
  return {
    key: group.key,
    label: group.label,
    items: group.items.slice(0, limit),
    more: Math.max(0, group.items.length - limit),
  };
}
