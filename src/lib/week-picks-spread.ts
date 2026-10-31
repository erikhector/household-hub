// Week picks' "Spread over the week": a suggested day for every pick in the
// planner's tray, shown as a preview with a reason per row. Nothing here
// writes; the planner places what the household accepts with "Place all"
// (placePicksAction). Pure, so the rules are unit-tested without a page.
//
// Three rules, each one a visible reason (no AI, the owner's call):
//  1. Habit: a recipe goes on the weekday the household usually cooks it,
//     read from its cooking history (habitWeekday below), when that dinner
//     is free.
//  2. Freshness: picks whose ingredients keep the shortest go on the
//     earliest free dinners, shortest-lived first (pickFreshness below).
//  3. Order: the rest fill the remaining free dinners in pick order.
//
// Only free dinners are filled (lunches stay the household's call), so more
// picks than free dinners leaves some in the tray, counted in `unplaced`.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday = 0 … Sunday = 6, the planner's own day order. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * How long a pick's shortest-lived ingredient keeps, in days, and which
 * ingredient that is (named in the reason: "Salmon keeps best early in the
 * week"). Null when nothing about the pick is known to be perishable.
 */
export type PickFreshness = { days: number; item: string };

export type SpreadPick = {
  id: string;
  habitWeekday: Weekday | null;
  freshness: PickFreshness | null;
};

export type SpreadReason =
  | { kind: "habit"; weekday: Weekday }
  | { kind: "fresh"; item: string }
  | { kind: "order" };

export type SpreadRow = { pickId: string; weekday: Weekday; reason: SpreadReason };

/**
 * A pick counts as perishable (rule 2) when an ingredient keeps this many
 * days or fewer. Three is the meat default in shelf-life.ts: fresh fish and
 * meat, or anything already in the pantry that runs out within three days.
 * Produce (5) and bakery (4) defaults are left out, or nearly every recipe
 * with an onion would jump the queue and the rule would mean nothing.
 */
export const PERISHABLE_WITHIN_DAYS = 3;

/**
 * Suggests a day for each pick. `freeWeekdays` are the dinners with nothing
 * planned that can still be cooked (the caller drops days already past).
 * `rotate` is Shuffle: it rotates the pick-order rows, so each tap offers
 * another arrangement while the habit and freshness rows stay put (they're
 * the reasons a household would trust). Rows come back in day order.
 */
export function suggestSpread(
  picks: SpreadPick[],
  freeWeekdays: Weekday[],
  rotate = 0,
): { rows: SpreadRow[]; unplaced: number } {
  const free = [...new Set(freeWeekdays)].sort((a, b) => a - b);
  const rows: SpreadRow[] = [];
  const left: SpreadPick[] = [];

  for (const pick of picks) {
    const day = pick.habitWeekday;
    if (day !== null && free.includes(day)) {
      rows.push({ pickId: pick.id, weekday: day, reason: { kind: "habit", weekday: day } });
      free.splice(free.indexOf(day), 1);
    } else {
      left.push(pick);
    }
  }

  const fresh = left
    .filter((pick) => pick.freshness !== null && pick.freshness.days <= PERISHABLE_WITHIN_DAYS)
    // Stable: equally perishable picks keep pick order.
    .sort((a, b) => a.freshness!.days - b.freshness!.days);
  let rest = left.filter((pick) => !fresh.includes(pick));
  if (rest.length > 1) {
    const k = ((rotate % rest.length) + rest.length) % rest.length;
    rest = [...rest.slice(k), ...rest.slice(0, k)];
  }

  for (const pick of fresh) {
    const day = free.shift();
    if (day === undefined) break;
    rows.push({ pickId: pick.id, weekday: day, reason: { kind: "fresh", item: pick.freshness!.item } });
  }
  for (const pick of rest) {
    const day = free.shift();
    if (day === undefined) break;
    rows.push({ pickId: pick.id, weekday: day, reason: { kind: "order" } });
  }

  rows.sort((a, b) => a.weekday - b.weekday);
  return { rows, unplaced: picks.length - rows.length };
}

/** Whether Shuffle can change anything: it only rotates pick-order rows. */
export function canShuffle(picks: SpreadPick[], freeWeekdays: Weekday[]): boolean {
  return suggestSpread(picks, freeWeekdays).rows.filter((row) => row.reason.kind === "order").length > 1;
}

/**
 * The weekday a recipe is "usually" cooked on, from the dates (`yyyy-mm-dd`)
 * it was cooked: at least twice on that weekday, and on it for at least half
 * of all cooks. Anything weaker is a coincidence, not a habit, and returns
 * null. A tie between two weekdays is no habit either.
 */
export function habitWeekday(cookedDateKeys: string[]): Weekday | null {
  if (cookedDateKeys.length < 2) return null;
  const counts = new Map<Weekday, number>();
  for (const key of cookedDateKeys) {
    const day = weekdayOf(key);
    if (day === null) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  let best: Weekday | null = null;
  let bestCount = 0;
  let tie = false;
  for (const [day, count] of counts) {
    if (count > bestCount) {
      best = day;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  if (best === null || tie || bestCount < 2 || bestCount * 2 < cookedDateKeys.length) return null;
  return best;
}

/** Monday-first weekday of a `yyyy-mm-dd` key, read in UTC like the planner. */
export function weekdayOf(dateKey: string): Weekday | null {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return ((date.getUTCDay() + 6) % 7) as Weekday;
}

export type FreshnessIngredient = {
  name: string;
  /** The linked pantry item, or null for an unlinked ingredient. */
  item: {
    name: string;
    quantity: number;
    expiresAt: Date | null;
    /** resolveShelfLifeDays(item.shelfLifeDays, item.category): -1 never expires. */
    shelfLifeDays: number | null;
  } | null;
};

/**
 * How perishable a recipe's ingredients are, from what the pantry knows.
 * The data model has two signals, both per pantry item:
 *  - in stock with an expiry date (real or estimated): the days left
 *    until it, never below zero;
 *  - not in stock (so it'll be bought for this week): its shelf life, the
 *    item's own `shelfLifeDays` or its category default (shelf-life.ts).
 * An unlinked ingredient, or an item with neither signal or marked "never
 * expires", says nothing. Returns the shortest, or null when nothing is
 * known. Only the recipe's own ingredients count, not its sub-recipes'.
 */
export function pickFreshness(ingredients: FreshnessIngredient[], now: Date): PickFreshness | null {
  let best: PickFreshness | null = null;
  for (const ingredient of ingredients) {
    const item = ingredient.item;
    if (!item) continue;
    let days: number | null = null;
    if (item.quantity > 0 && item.expiresAt) {
      days = Math.max(0, Math.floor((item.expiresAt.getTime() - now.getTime()) / DAY_MS));
    } else if (item.quantity <= 0 && item.shelfLifeDays !== null && item.shelfLifeDays >= 0) {
      days = item.shelfLifeDays;
    }
    if (days === null) continue;
    if (!best || days < best.days) best = { days, item: item.name };
  }
  return best;
}
