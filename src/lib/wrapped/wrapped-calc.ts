// Squirrel Wrapped: the household's year in review, as numbers and a list of
// story cards. Pure (no Prisma, no clock): load.ts fetches the household's
// rows for the year and this turns them into the story, so every rule below
// is unit-tested in wrapped-calc.test.ts. See REQUIREMENTS.md, "Squirrel
// Wrapped", and docs/superpowers/specs/2026-11-27-squirrel-wrapped-design.md.
//
// Two kinds of date meet here, the same split the rest of the app makes:
//   - Instants (a list's completedAt, a meal's consumedAt, a tick) are read
//     on the household viewer's own clock: a meal cooked at 23:30 on New
//     Year's Eve in Stockholm belongs to the old year, whatever UTC says.
//     localDayNumber (recurrence.ts) is the one converter.
//   - Calendar days (a HouseholdEvent's or a Transaction's `date`) are the
//     UTC midnight of the day someone picked, so only their UTC fields are
//     read (household-events.ts, budget-transaction-days.ts).
//
// What it deliberately doesn't do (the design's guardrails):
//   - No per-person numbers. HouseholdTask keeps only its latest completion,
//     so "who did most" can't be counted honestly, and a household app
//     shouldn't rank its members anyway. Everything is the household's.
//   - Money is a neutral fact: how many transactions were tracked. No
//     amounts, no "you saved", and it never feeds the persona or the
//     activity totals, so tracking money can't make a year look "better".

import { localDayNumber, startOfLocalDay } from "@/app/dashboard/tasks/recurrence";
import { dayNumberToDate, eventDayNumber, expandEventOccurrences, type EventRecurrence } from "@/lib/household-events";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Below this much activity in the year, the page shows "check back later". */
export const WRAPPED_MIN_ACTIVITY = 10;
/** ...and below this many distinct active days (one busy afternoon is no year). */
const WRAPPED_MIN_ACTIVE_DAYS = 3;
/** A "most bought" / "most cooked" needs at least this many repeats to be worth naming. */
const WRAPPED_TOP_MIN_COUNT = 2;

// Stock events that put something into the pantry: a +1 tap or a scan
// ("restocked") and a shopping trip put away ("trip"). See stock-history.ts.
const RESTOCK_REASONS = new Set(["restocked", "trip"]);

export type WrappedRows = {
  /** Shopping lists completed in the year (completedAt set). */
  completedLists: { completedAt: Date }[];
  /** Shopping list rows marked bought. Ticked by hand (checkedOffAt) or put
   * away / registered from a receipt (putAwayAt). */
  boughtItems: { name: string; checkedOffAt: Date | null; putAwayAt: Date | null }[];
  /** Meal plan entries marked cooked, with their recipe if it still exists. */
  cookedMeals: { consumedAt: Date; recipeId: string | null; recipeName: string | null }[];
  /** The pantry's stock journal (InventoryItemEvent), with the item's name. */
  stockEvents: { reason: string; delta: number; createdAt: Date; itemName: string }[];
  /** Tasks whose latest completion is in the year. */
  completedTasks: { completedAt: Date }[];
  /** Calendar events that can fall in the range: repeats that start on or
   * before its last day, and one-offs dated inside it. */
  events: { date: Date; recurrence: EventRecurrence | null }[];
  /** Household budget transactions, by their calendar day. */
  transactions: { date: Date }[];
};

export type WrappedInput = WrappedRows & {
  year: number;
  /** The viewer's IANA time zone (the time_zone cookie). */
  timeZone: string;
  now: Date;
};

type WrappedTop = { name: string; count: number };

export type WrappedPersona = "planner" | "chef" | "forager" | "stocker";

export type WrappedStats = {
  year: number;
  shopping: { listsCompleted: number; itemsBought: number; topItem: WrappedTop | null };
  meals: { cooked: number; topRecipe: WrappedTop | null };
  pantry: {
    /** Every put-in: hand restocks and trips put away. The card's number. */
    restocks: number;
    /** Just the hand restocks (a +1 or a scan): a trip put away is already
     * items bought, so only these score the stocker persona. */
    handRestocks: number;
    topRestocked: WrappedTop | null;
  };
  tasks: { completed: number };
  calendar: {
    /** Every day an event fell on in the range, repeats included. The card's number. */
    events: number;
    /** Events whose own start date is in the range: the ones planned this
     * year, so only these score the planner persona. */
    planned: number;
  };
  activity: {
    /** Countable things done (see computeWrapped); money and calendar
     * occurrences not included. */
    total: number;
    /** Distinct local days with any activity. */
    activeDays: number;
    /** 0-11, or null with no activity. Ties go to the earlier month. */
    busiestMonth: number | null;
  };
  money: { transactions: number };
  persona: WrappedPersona;
};

export type WrappedCard =
  | { kind: "intro" }
  | { kind: "shopping" }
  | { kind: "meals" }
  | { kind: "pantry" }
  | { kind: "tasks" }
  | { kind: "calendar" }
  | { kind: "busiest" }
  | { kind: "money" }
  | { kind: "persona" };

export type WrappedResult =
  | { state: "thin"; year: number }
  | { state: "story"; stats: WrappedStats; cards: WrappedCard[] };

/** The span Wrapped covers for `year`: 1 January to today (or 31 December
 * once the year is over), as local day numbers and as the instants the
 * loader's queries take. `until` is exclusive. */
export function wrappedRange(year: number, now: Date, timeZone: string) {
  const firstDay = Date.UTC(year, 0, 1) / MS_PER_DAY;
  const yearLastDay = Date.UTC(year + 1, 0, 1) / MS_PER_DAY - 1;
  const lastDay = Math.min(yearLastDay, localDayNumber(now, timeZone));
  return {
    firstDay,
    lastDay,
    since: startOfLocalDay(firstDay, timeZone),
    until: startOfLocalDay(lastDay + 1, timeZone),
    /** The first and last calendar days, as UTC midnights (for @db.Date columns). */
    firstDate: dayNumberToDate(firstDay),
    lastDate: dayNumberToDate(Math.max(firstDay, lastDay)),
  };
}

/** The most frequent name (case- and space-insensitive), shown in its most
 * common spelling; null when nothing repeats WRAPPED_TOP_MIN_COUNT times.
 * Ties go to the alphabetically first, so the answer never depends on row
 * order. */
function topByName(names: readonly string[]): WrappedTop | null {
  const groups = new Map<string, Map<string, number>>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("en").replace(/\s+/g, " ");
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(name, (spellings.get(name) ?? 0) + 1);
    groups.set(key, spellings);
  }
  let best: { key: string; count: number; spellings: Map<string, number> } | null = null;
  for (const [key, spellings] of groups) {
    const count = [...spellings.values()].reduce((sum, n) => sum + n, 0);
    if (!best || count > best.count || (count === best.count && key < best.key)) best = { key, count, spellings };
  }
  if (!best || best.count < WRAPPED_TOP_MIN_COUNT) return null;
  const [spelling] = [...best.spellings].sort(([a, an], [b, bn]) => bn - an || (a < b ? -1 : a > b ? 1 : 0))[0];
  return { name: spelling, count: best.count };
}

/** The persona the closing card names. Each feature's activity is weighted
 * by roughly how much effort one unit is (cooking a meal is more than
 * ticking one item), and the biggest wins; ties go in the order below, so
 * the same stats always give the same squirrel. Money never counts.
 *
 * Nothing scores twice or for free: a trip put away is already items
 * bought, so the stocker counts only hand restocks; and a repeating event
 * is planned once, not once per occurrence, so the planner counts the
 * events dated in the range, not every day a weekly swim fell on (one
 * event made years ago would otherwise outscore a year of cooking). */
export function pickPersona(stats: Pick<WrappedStats, "shopping" | "meals" | "pantry" | "tasks" | "calendar">): WrappedPersona {
  const scores: [WrappedPersona, number][] = [
    ["planner", (stats.tasks.completed + stats.calendar.planned) * 2],
    ["chef", stats.meals.cooked * 4],
    ["forager", stats.shopping.itemsBought + stats.shopping.listsCompleted * 3],
    ["stocker", stats.pantry.handRestocks * 2],
  ];
  let best = scores[0];
  for (const entry of scores) if (entry[1] > best[1]) best = entry;
  return best[0];
}

export function computeWrapped(input: WrappedInput): WrappedResult {
  const { year, timeZone, now } = input;
  const { firstDay, lastDay, firstDate, lastDate } = wrappedRange(year, now, timeZone);
  const inRange = (day: number) => day >= firstDay && day <= lastDay;

  // Every countable thing lands on a local day; the days give "active
  // days" and the months "busiest month". Money and calendar occurrences
  // are shown but never counted here (see each below).
  const activeDays = new Set<number>();
  const perMonth = new Array<number>(12).fill(0);
  let total = 0;
  const count = (day: number) => {
    activeDays.add(day);
    perMonth[dayNumberToDate(day).getUTCMonth()] += 1;
    total += 1;
  };
  const instantDay = (instant: Date) => localDayNumber(instant, timeZone);

  const listDays = input.completedLists.map((l) => instantDay(l.completedAt)).filter(inRange);
  listDays.forEach(count);

  // A row ticked by hand carries the tick; one registered from a receipt or
  // put away without a tick has only putAwayAt. Either is the moment it was
  // bought, and a row with neither isn't bought yet.
  const bought = input.boughtItems
    .map((item) => ({ name: item.name, at: item.checkedOffAt ?? item.putAwayAt }))
    .filter((item): item is { name: string; at: Date } => item.at !== null)
    .map((item) => ({ name: item.name, day: instantDay(item.at) }))
    .filter((item) => inRange(item.day));
  bought.forEach((item) => count(item.day));

  const cooked = input.cookedMeals.filter((meal) => inRange(instantDay(meal.consumedAt)));
  cooked.forEach((meal) => count(instantDay(meal.consumedAt)));
  const recipeNames = new Map<string, string>();
  for (const meal of cooked) if (meal.recipeId && meal.recipeName) recipeNames.set(meal.recipeId, meal.recipeName);
  // Grouped by recipe id, not name, then named: two recipes can share a name.
  const recipeTop = topByName(cooked.filter((m) => m.recipeId && m.recipeName).map((m) => m.recipeId!));
  const topRecipe = recipeTop ? { name: recipeNames.get(recipeTop.name)!, count: recipeTop.count } : null;

  // The stock journal keeps only an item's latest STOCK_HISTORY_CAP events
  // (stock-history.ts), so this is a floor, which is why the card says "at
  // least". A trip put away is already counted as items bought, so only a
  // hand restock (a +1 or a scan) adds to the activity total.
  const restocks = input.stockEvents.filter(
    (event) => RESTOCK_REASONS.has(event.reason) && event.delta > 0 && inRange(instantDay(event.createdAt)),
  );
  const handRestocks = restocks.filter((event) => event.reason === "restocked");
  handRestocks.forEach((event) => count(instantDay(event.createdAt)));

  const taskDays = input.completedTasks.map((t) => instantDay(t.completedAt)).filter(inRange);
  taskDays.forEach(count);

  // Every day an event fell on (a weekly swim is 52 of them), up to today,
  // for the calendar card. An occurrence isn't something anyone did, though:
  // a weekly event made in an earlier year lands on every week of this one
  // untouched. Counting those filled the active days and the busiest month
  // with weeks nobody opened the app, and lifted a household that did
  // nothing out of "check back later". So the calendar adds nothing to the
  // activity total, the active days or the busiest month.
  let eventCount = 0;
  for (const event of input.events) {
    for (const day of expandEventOccurrences(event, firstDate, lastDate)) {
      if (inRange(eventDayNumber(day))) eventCount += 1;
    }
  }
  const plannedEvents = input.events.filter((event) => inRange(eventDayNumber(event.date))).length;

  const transactions = input.transactions.filter((t) => inRange(eventDayNumber(t.date))).length;

  let busiestMonth: number | null = null;
  perMonth.forEach((n, month) => {
    if (n > 0 && (busiestMonth === null || n > perMonth[busiestMonth])) busiestMonth = month;
  });

  if (total < WRAPPED_MIN_ACTIVITY || activeDays.size < WRAPPED_MIN_ACTIVE_DAYS) return { state: "thin", year };

  const features = {
    shopping: { listsCompleted: listDays.length, itemsBought: bought.length, topItem: topByName(bought.map((b) => b.name)) },
    meals: { cooked: cooked.length, topRecipe },
    pantry: { restocks: restocks.length, handRestocks: handRestocks.length, topRestocked: topByName(restocks.map((r) => r.itemName)) },
    tasks: { completed: taskDays.length },
    calendar: { events: eventCount, planned: plannedEvents },
  };
  const stats: WrappedStats = {
    year,
    ...features,
    activity: { total, activeDays: activeDays.size, busiestMonth },
    money: { transactions },
    persona: pickPersona(features),
  };

  // A card with nothing to say is left out, so a household that never
  // cooks doesn't get a "0 meals" card.
  const cards: WrappedCard[] = [{ kind: "intro" }];
  if (stats.shopping.listsCompleted + stats.shopping.itemsBought > 0) cards.push({ kind: "shopping" });
  if (stats.meals.cooked > 0) cards.push({ kind: "meals" });
  if (stats.pantry.restocks > 0) cards.push({ kind: "pantry" });
  if (stats.tasks.completed > 0) cards.push({ kind: "tasks" });
  if (stats.calendar.events > 0) cards.push({ kind: "calendar" });
  cards.push({ kind: "busiest" });
  if (stats.money.transactions > 0) cards.push({ kind: "money" });
  cards.push({ kind: "persona" });

  return { state: "story", stats, cards };
}
