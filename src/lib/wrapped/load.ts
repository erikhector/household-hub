import "server-only";

// Squirrel Wrapped's queries: one household's rows for one year, selected
// down to the columns wrapped-calc.ts reads, then handed to it. The caller
// passes the household id it got from requireHousehold(), never one from the
// client, and every query below is scoped by it (directly or through the
// row's list, meal plan or item). Opt-in sample data (UX-136) is left out:
// it's a demo, not the household's year.
//
// Seven small indexed queries in parallel. A busy household buys a few
// thousand items a year, which is still a modest read for a page that's
// opened a handful of times around New Year.

import { prisma } from "@/lib/prisma";
import { computeWrapped, wrappedRange, type WrappedResult } from "@/lib/wrapped/wrapped-calc";

export async function loadWrapped(householdId: string, year: number, now: Date, timeZone: string): Promise<WrappedResult> {
  const { since, until, firstDate, lastDate } = wrappedRange(year, now, timeZone);
  const instant = { gte: since, lt: until };

  const [completedLists, boughtItems, cookedMeals, stockEvents, completedTasks, events, transactions] = await Promise.all([
    prisma.shoppingList.findMany({
      where: { householdId, sample: null, completedAt: instant },
      select: { completedAt: true },
    }),
    prisma.shoppingListItem.findMany({
      where: {
        shoppingList: { householdId },
        sample: null,
        purchased: true,
        OR: [{ checkedOffAt: instant }, { checkedOffAt: null, putAwayAt: instant }],
      },
      select: { name: true, checkedOffAt: true, putAwayAt: true },
    }),
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId }, sample: null, consumedAt: instant },
      select: { consumedAt: true, recipeId: true, recipe: { select: { name: true } } },
    }),
    prisma.inventoryItemEvent.findMany({
      where: { householdId, item: { sample: null }, reason: { in: ["restocked", "trip"] }, delta: { gt: 0 }, createdAt: instant },
      select: { reason: true, delta: true, createdAt: true, item: { select: { name: true } } },
    }),
    prisma.householdTask.findMany({
      where: { householdId, sample: null, completedAt: instant },
      select: { completedAt: true },
    }),
    // A repeat that started in an earlier year still lands on days in this
    // one, so every repeat up to the last day is read and expanded; a
    // one-off only counts on its own day, so older ones stay unread.
    prisma.householdEvent.findMany({
      where: { householdId, date: { lte: lastDate }, OR: [{ recurrence: { not: null } }, { date: { gte: firstDate } }] },
      select: { date: true, recurrence: true },
    }),
    prisma.transaction.findMany({
      where: { householdId, date: { gte: firstDate, lt: new Date(lastDate.getTime() + 24 * 60 * 60 * 1000) } },
      select: { date: true },
    }),
  ]);

  return computeWrapped({
    year,
    timeZone,
    now,
    completedLists: completedLists.flatMap((l) => (l.completedAt ? [{ completedAt: l.completedAt }] : [])),
    boughtItems,
    cookedMeals: cookedMeals.flatMap((m) =>
      m.consumedAt ? [{ consumedAt: m.consumedAt, recipeId: m.recipeId, recipeName: m.recipe?.name ?? null }] : [],
    ),
    stockEvents: stockEvents.map((e) => ({ reason: e.reason, delta: e.delta, createdAt: e.createdAt, itemName: e.item.name })),
    completedTasks: completedTasks.flatMap((t) => (t.completedAt ? [{ completedAt: t.completedAt }] : [])),
    events,
    transactions,
  });
}
