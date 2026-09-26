// AUTO-9 — learn the order a household walks its store in, from the order it
// actually ticks things off, so shopping mode's category groups (AUTO-3,
// shopping-mode-grouping.ts) gradually stop following AUTO_CATEGORY_KEYS'
// fixed produce → … → bathroom guess. Pure and dependency-free apart from
// that key list, so it's unit-testable without a database: the actions
// layer only reads the stored order, calls these, and writes the result.
//
// Categories are identified by a *category key* (see categoryKey in
// shopping-mode-grouping.ts): "auto:<key>" for one of AUTO_CATEGORY_KEYS
// (so "Dairy & eggs" and "Mejeri & ägg" learn as one category), otherwise
// the custom category's trimmed, lower-cased text. "Other" (no category, or
// the "Uncategorized" placeholder) has no key and is never learned — it
// always sorts last.
//
// Positions live on a 0..1 scale: 0 is the entrance end of the store, 1 the
// checkout end. A known category with nothing learned yet sits at its
// AUTO_CATEGORY_KEYS slot's midpoint on that scale, and a custom one at 1
// (after all of them), which reproduces AUTO-3's fixed order exactly for a
// household that hasn't completed a trip yet.

import { AUTO_CATEGORY_KEYS } from "@/lib/inventory/auto-category";

/** Prefix that marks a category key as one of AUTO_CATEGORY_KEYS rather
 * than a household's own category text. */
export const KNOWN_CATEGORY_KEY_PREFIX = "auto:";

/**
 * How far one trip pulls a category toward where it was observed. Low
 * enough that a single odd trip (the dairy aisle was being restocked, so
 * you came back for the milk) only nudges things, high enough that a
 * household sees its own layout take over within a handful of shops:
 * a category consistently observed at the other end of the store crosses
 * the midpoint after two trips.
 */
export const LEARNING_RATE = 0.3;

/** The household's stored order (Household.categoryOrderLearned /
 * categoryOrderManual, see prisma/schema.prisma). */
export type StoreOrder = {
  learned: Readonly<Record<string, number>>;
  /** Keys in the order someone arranged them by hand; empty = none. */
  manual: readonly string[];
};

export const EMPTY_STORE_ORDER: StoreOrder = { learned: {}, manual: [] };

/** One ticked-off row of a finished trip: its category key (null for
 * "Other") and when it was ticked off (ShoppingListItem.checkedOffAt). */
export type CheckOff = { key: string | null; at: Date };

const KNOWN_KEY_INDEX = new Map<string, number>(
  AUTO_CATEGORY_KEYS.map((key, index) => [`${KNOWN_CATEGORY_KEY_PREFIX}${key}`, index]),
);

/**
 * Tolerant read of Household.categoryOrderLearned — a Json column, so
 * nothing but this function stands between a malformed value and the sort.
 * Anything that isn't a finite number keyed by a non-empty string is
 * dropped rather than failing the whole page.
 */
export function parseLearnedOrder(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const learned: Record<string, number> = {};
  for (const [key, position] of Object.entries(value)) {
    if (key !== "" && typeof position === "number" && Number.isFinite(position)) learned[key] = position;
  }
  return learned;
}

/** Where a category sits before anything has been learned about it. */
export function defaultPosition(key: string): number {
  const index = KNOWN_KEY_INDEX.get(key);
  return index === undefined ? 1 : (index + 0.5) / AUTO_CATEGORY_KEYS.length;
}

/**
 * Sort key for a category: a hand-arranged order always wins (tier 0, by
 * its place in that order), then everything else by its learned position,
 * falling back to its default one (tier 1). A category the manual order
 * doesn't mention — a new custom one added after the order was saved —
 * lands after every arranged one rather than being wedged somewhere in
 * the middle of an order a person chose.
 */
export function storeOrderSortKey(key: string, order: StoreOrder): [tier: number, position: number] {
  const manualIndex = order.manual.indexOf(key);
  if (manualIndex !== -1) return [0, manualIndex];
  return [1, order.learned[key] ?? defaultPosition(key)];
}

/** Comparator over category keys; ties (two never-learned custom
 * categories, both at 1) fall back to the key text, i.e. alphabetical. */
export function compareCategoryKeys(a: string, b: string, order: StoreOrder): number {
  const [tierA, posA] = storeOrderSortKey(a, order);
  const [tierB, posB] = storeOrderSortKey(b, order);
  return tierA - tierB || posA - posB || a.localeCompare(b);
}

/** Every key the household has an opinion about (plus AUTO_CATEGORY_KEYS
 * and `extra`), in current walk order. */
export function effectiveOrder(order: StoreOrder, extra: readonly string[] = []): string[] {
  const keys = new Set<string>([
    ...KNOWN_KEY_INDEX.keys(),
    ...Object.keys(order.learned),
    ...order.manual,
    ...extra,
  ]);
  return [...keys].sort((a, b) => compareCategoryKeys(a, b, order));
}

/**
 * Where each category was observed in one finished trip, on the same 0..1
 * scale as the stored positions: rows are sorted by when they were ticked
 * off, each gets the midpoint of its slot ((i + 0.5) / n, so neither the
 * first nor the last category is pinned hard to the very ends), and a
 * category's observation is the mean over its rows.
 *
 * "Other" rows are dropped first — they belong to no aisle. A trip that
 * touched fewer than two categories says nothing about their order
 * relative to each other, so it yields no observations at all.
 */
export function observedCategoryRanks(checkOffs: readonly CheckOff[]): Map<string, number> {
  const kept = checkOffs
    .filter((c): c is { key: string; at: Date } => c.key !== null)
    // Array.prototype.sort is stable, so two rows ticked in the same
    // millisecond keep their list order.
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (new Set(kept.map((c) => c.key)).size < 2) return new Map();

  const sums = new Map<string, { total: number; count: number }>();
  kept.forEach((checkOff, i) => {
    const rank = (i + 0.5) / kept.length;
    const entry = sums.get(checkOff.key) ?? { total: 0, count: 0 };
    entry.total += rank;
    entry.count += 1;
    sums.set(checkOff.key, entry);
  });
  return new Map([...sums].map(([key, { total, count }]) => [key, total / count]));
}

/**
 * One exponential-moving-average step: every observed category moves
 * `rate` of the way from where it currently sits (learned, or its default
 * if this is the first time it's been seen) toward where it was observed.
 * Categories the trip didn't touch keep their position untouched — not
 * buying frozen food this week says nothing about where the freezers are.
 * Returns a new object; rounded to 4 decimals so the stored JSON stays
 * readable without losing any ordering that matters.
 */
export function nudgeLearnedOrder(
  learned: Readonly<Record<string, number>>,
  observed: ReadonlyMap<string, number>,
  rate: number = LEARNING_RATE,
): Record<string, number> {
  const next: Record<string, number> = { ...learned };
  for (const [key, target] of observed) {
    const prev = learned[key] ?? defaultPosition(key);
    next[key] = Math.round((prev + rate * (target - prev)) * 10_000) / 10_000;
  }
  return next;
}

/** A finished trip's check-offs → the household's next learned order, or
 * null when the trip taught nothing (so the caller can skip the write). */
export function learnFromCheckOffs(
  learned: Readonly<Record<string, number>>,
  checkOffs: readonly CheckOff[],
  rate: number = LEARNING_RATE,
): Record<string, number> | null {
  const observed = observedCategoryRanks(checkOffs);
  return observed.size === 0 ? null : nudgeLearnedOrder(learned, observed, rate);
}

/**
 * Applies a hand-made reorder of only the categories one list happens to
 * show to the household's whole order: the reordered keys are poured back
 * into the slots those same keys occupied in `fullOrder`, and every other
 * key stays exactly where it was. So arranging this week's four sections
 * never shuffles the frozen aisle this list didn't have. Keys in
 * `reordered` that `fullOrder` lacks are appended (the caller normally
 * includes them, this just keeps the function total).
 */
export function applySubsetReorder(fullOrder: readonly string[], reordered: readonly string[]): string[] {
  const unique = [...new Set(reordered)];
  const moving = new Set(unique);
  const queue = unique.filter((key) => fullOrder.includes(key));
  let next = 0;
  const merged = fullOrder.map((key) => (moving.has(key) ? queue[next++] : key));
  return [...merged, ...unique.filter((key) => !fullOrder.includes(key))];
}
