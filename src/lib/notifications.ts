// Live-computed alerts for the notification bell (nav — see
// `src/components/notifications/`). No database table, no background job:
// every call re-derives the current state from `InventoryItem` and
// `MealPlanEntry` directly, so an alert simply disappears once its
// underlying condition is resolved. Callers must resolve `householdId` from
// their own `requireHousehold()` call first — this trusts its argument the
// same way `findOrCreateInventoryItem`/`findOrCreateGroceriesCategory` do.

import { prisma } from "@/lib/prisma";
import { getStockStatus, type StockStatus } from "@/lib/stock-status";
import { addDays, getWeekStart, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";

// today + the next 2 days — kept small so this stays a cheap, genuinely
// useful nudge rather than a noisy wall of far-future gaps.
const MEAL_GAP_LOOKAHEAD_DAYS = 2;

export type LowStockNotification = {
  kind: "lowStock";
  itemId: string;
  name: string;
  quantity: number;
  unit: string;
  status: Extract<StockStatus, "low" | "out">;
};

export type MealGapNotification = {
  kind: "mealGap";
  dateKey: string;
  weekStartKey: string;
  offsetDays: number;
};

export type NotificationItem = LowStockNotification | MealGapNotification;

async function getLowStockNotifications(householdId: string): Promise<LowStockNotification[]> {
  const items = await prisma.inventoryItem.findMany({
    where: { householdId },
    orderBy: { name: "asc" },
  });

  return items.flatMap((item): LowStockNotification[] => {
    const status = getStockStatus(item.quantity, item.lowStockThreshold);
    if (status === "in") return [];
    return [
      {
        kind: "lowStock",
        itemId: item.id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        status,
      },
    ];
  });
}

async function getMealPlanGapNotifications(householdId: string): Promise<MealGapNotification[]> {
  const today = parseDateKey(toDateKey(new Date()));
  const lastDay = addDays(today, MEAL_GAP_LOOKAHEAD_DAYS);

  const entries = await prisma.mealPlanEntry.findMany({
    where: {
      mealPlan: { householdId },
      date: { gte: today, lte: lastDay },
    },
    select: { date: true },
  });
  const plannedDateKeys = new Set(entries.map((entry) => toDateKey(entry.date)));

  const gaps: MealGapNotification[] = [];
  for (let offsetDays = 0; offsetDays <= MEAL_GAP_LOOKAHEAD_DAYS; offsetDays++) {
    const date = addDays(today, offsetDays);
    const dateKey = toDateKey(date);
    if (plannedDateKeys.has(dateKey)) continue;
    gaps.push({
      kind: "mealGap",
      dateKey,
      weekStartKey: toDateKey(getWeekStart(date)),
      offsetDays,
    });
  }
  return gaps;
}

export async function getNotifications(householdId: string): Promise<NotificationItem[]> {
  const [lowStock, mealGaps] = await Promise.all([
    getLowStockNotifications(householdId),
    getMealPlanGapNotifications(householdId),
  ]);
  return [...lowStock, ...mealGaps];
}
