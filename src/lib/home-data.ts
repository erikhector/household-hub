import { cacheLife, cacheTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isHomeCacheEnabled } from "@/lib/home-cache-flag";
import { householdTag } from "@/lib/household-cache";
import { loadSampleDataState } from "@/lib/sample-data-state";
import { loadHouseholdSafeToSpend } from "@/lib/household-safe-to-spend";
import { normalizeStartDay, periodBounds, periodKeyOf } from "@/lib/budget-date-utils";
import { parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { loadMissingIngredients } from "@/app/dashboard/meal-planning/missing-for-range";
import { getActiveBatches } from "@/app/dashboard/meal-planning/prepared-batches";

const DAY_MS = 24 * 60 * 60 * 1000;

// PERF-32a: the household half of Home's parallel batch (src/app/dashboard/
// page.tsx), moved here so it can sit behind "use cache: remote" when the
// Home cache is on (src/lib/home-cache-flag.ts). The page still loads the
// rest itself, outside any cache:
// - the three cookie-backed setup flags (cookies() throws inside a cache);
// - the user's own data (name, personal budget), which other members' writes
//   never touch and which PERF-35 caches by userId if it pays off;
// - the member count, a cheap count whose writers are the invite and
//   membership flows, kept uncached so they need no invalidation;
// - incoming stock, whose two-week window is measured to the millisecond;
// - the Coming up card's calendar events (GAP-35), one small indexed query
//   in its own component, so the calendar's actions need no invalidation.
//
// Everything a cached call reads comes in as an argument, so it's in the
// cache key: the household, the user (whose tasks come first), the UTC day
// (the planner's "today", and so tonight's dinner) and the budget period. No
// clock is read inside: "now" would make every call a new key.
type HomeDataKey = {
  householdId: string;
  userId: string;
  /** The UTC day, "YYYY-MM-DD": planner dates are UTC midnights (date-utils.ts). */
  dayKey: string;
  budgetStartDay: number;
  /** The household budget period today falls in (periodKeyOf). */
  budgetPeriodKey: string;
};

async function queryHomeData({ householdId, userId, dayKey, budgetStartDay, budgetPeriodKey }: HomeDataKey) {
  const plannerToday = parseDateKey(dayKey);
  // Safe to spend only reads its date to find the period, so the period's
  // first day gives the same number as the moment it was computed from.
  const budgetDate = periodBounds(budgetPeriodKey, budgetStartDay).start;
  const [
    todayTasks,
    items,
    activeLists,
    shoppingListCount,
    householdBudget,
    tonightEntries,
    tonightMissing,
    plannedMealCount,
    prepBatches,
    sampleState,
  ] = await Promise.all([
    // UX-70: the tasks that need *you*: yours and the unassigned ones
    // (nobody's, so anybody's). Filtered by the assignee's user rather than a
    // membership id looked up first, so it runs in parallel with everything
    // else instead of after it. A completed task can only reopen if it
    // recurs, so the rest of the done ones are left in the database.
    prisma.householdTask.findMany({
      where: {
        householdId,
        OR: [{ assignedToMemberId: null }, { assignedToMember: { userId } }],
        AND: [{ OR: [{ completedAt: null }, { recurrenceIntervalDays: { not: null } }] }],
      },
      select: {
        id: true,
        title: true,
        assignedToMemberId: true,
        completedAt: true,
        recurrenceIntervalDays: true,
        recurrenceAnchorAt: true,
        skippedUntil: true,
        dueDate: true,
        createdAt: true,
      },
      // MAINT-114: the tasks page's order, ties and all (see its query).
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    // The columns the stock and expiry summaries read, plus what the "Add
    // to list" dialog offers as names and units — not every inventory
    // column for every item.
    prisma.inventoryItem.findMany({
      where: { householdId },
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        quantity: true,
        everStocked: true,
        lowStockThreshold: true,
        expiresAt: true,
      },
    }),
    prisma.shoppingList.findMany({
      where: { householdId, status: "ACTIVE" },
      // The rows still to buy: their count for the list row, which
      // inventory items they restock for the "already on the list" line, and
      // their names, so a missing ingredient already added isn't offered again.
      select: {
        id: true,
        name: true,
        isDefault: true,
        createdAt: true,
        items: { where: { purchased: false }, select: { inventoryItemId: true, name: true } },
      },
    }),
    prisma.shoppingList.count({ where: { householdId } }),
    // The household's safe to spend only exists once the budget has
    // categories, so the count gates it, inside this one parallel slot.
    prisma.budgetCategory.count({ where: { householdId } }).then(async (count) => ({
      count,
      safeToSpend: count > 0 ? await loadHouseholdSafeToSpend(householdId, budgetDate, budgetStartDay) : null,
    })),
    // Tonight's dinner. The recipe's steps decide whether it has a cook
    // mode to start.
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId }, date: plannerToday, mealType: "DINNER" },
      select: {
        freeformName: true,
        portions: true,
        recipe: { select: { id: true, name: true, instructions: true } },
      },
    }),
    // UX-HOME-3: what tonight's recipes need that the pantry hasn't got:
    // the planner's own "Add missing" calculation, for one day's dinner.
    // With no recipe planned it stops after one small query.
    loadMissingIngredients(householdId, { from: plannerToday, to: new Date(plannerToday.getTime() + DAY_MS) }, "DINNER"),
    // UX-69: the "Plan this week's meals" step is done once anything is planned.
    prisma.mealPlanEntry.count({ where: { mealPlan: { householdId } } }),
    getActiveBatches(householdId),
    loadSampleDataState(householdId),
  ]);
  return {
    todayTasks,
    items,
    activeLists,
    shoppingListCount,
    householdBudget,
    tonightEntries,
    tonightMissing,
    plannedMealCount,
    prepBatches,
    sampleState,
  };
}

// The cached copy. Tagged with the household's Home tag, which every Server
// Action that writes this data clears (invalidateHome in household-cache.ts),
// and with a short revalidate as the backstop for a write that doesn't: an
// entry older than five minutes is served once more while a fresh one is
// built. stale 30 is the client-cache minimum Next allows, close to the 15 s
// the dashboard already uses (next.config.ts, PERF-21).
async function queryHomeDataCached(args: HomeDataKey) {
  "use cache: remote";
  cacheTag(householdTag(args.householdId, "home"));
  cacheLife({ stale: 30, revalidate: 300, expire: 3600 });
  return queryHomeData(args);
}

/**
 * Home's household data as of `now`, cached across requests and instances
 * when the Home cache is on, straight from the database when it's off (the
 * default). Call only after requireHousehold(), with its household and user.
 */
export async function loadHomeData(household: { id: string; budgetMonthStartDay: number }, userId: string, now: Date) {
  const budgetStartDay = normalizeStartDay(household.budgetMonthStartDay);
  const key: HomeDataKey = {
    householdId: household.id,
    userId,
    dayKey: toDateKey(now),
    budgetStartDay,
    budgetPeriodKey: periodKeyOf(now, budgetStartDay),
  };
  const cached = isHomeCacheEnabled();
  const started = performance.now();
  const data = await (cached ? queryHomeDataCached(key) : queryHomeData(key));
  // PERF-32b's measurement: with HOME_CACHE_TIMING=1 every Home render logs
  // how long this batch took, with the cache on or off, so the owner can
  // compare the two in Vercel's logs (DEPLOYMENT.md, "Home cache"). No ids.
  if (process.env.HOME_CACHE_TIMING === "1") {
    logger.info("home batch", { cache: cached ? "on" : "off", ms: Math.round(performance.now() - started) });
  }
  return data;
}
