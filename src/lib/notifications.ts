// Persisted alerts for the notification bell (nav — see
// `src/components/notifications/`). Backed by the `Notification` table (see
// its doc comment in prisma/schema.prisma) — unlike the fully live-computed
// design this replaced, alerts are created once, at the moment a trigger
// condition happens, and stick around until a user dismisses them (see
// dismissNotificationAction in src/lib/actions/notifications.ts).
//
// Only two triggers exist:
// - Out-of-stock: an existing InventoryItem's quantity crossing from > 0
//   into <= 0 — see `recordOutOfStockTransition`, called from every action
//   that can *decrease* an existing item's quantity (adjustQuantityAction,
//   markItemEmptyAction, updateInventoryItemAction, bulkUpdateFieldAction,
//   markMealEntryCookedAction, togglePurchasedAction). Deliberately never
//   called from anything that *creates* an item (createInventoryItemAction,
//   quickAddInventoryItemAction, addStarterKitItemsAction,
//   findOrCreateInventoryItem, createInventoryItemFromShoppingListItemAction)
//   — those items often start at quantity 0, which is not a depletion event.
// - Meal not logged: a past MealPlanEntry whose `consumedAt` is still null —
//   synced lazily in `syncMealNotLoggedNotifications` below (no background
//   job) whenever the bell's contents are fetched.
//
// Callers must resolve `householdId` from their own `requireHousehold()`
// call first — this trusts its argument the same way
// `findOrCreateInventoryItem`/`findOrCreateGroceriesCategory` do.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getWeekStart, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { sendPushToHousehold } from "@/lib/push";

export type OutOfStockNotification = {
  id: string;
  kind: "outOfStock";
  itemId: string;
  name: string;
};

export type MealNotLoggedNotification = {
  id: string;
  kind: "mealNotLogged";
  entryId: string;
  dateKey: string;
  weekStartKey: string;
  name: string;
};

export type NotificationItem = OutOfStockNotification | MealNotLoggedNotification;

type DbClient = typeof prisma | Prisma.TransactionClient;

// Called from every action that can decrease an already-existing
// InventoryItem's quantity, right after computing its new value. Only fires
// when the item actually crosses from in-stock into out-of-stock — a
// continued decrease while already at 0, or a decrease that doesn't reach 0,
// is a no-op. Deduped against any already-active (undismissed) alert for the
// same item so repeated small decrements past zero don't pile up duplicates.
export async function recordOutOfStockTransition(
  db: DbClient,
  householdId: string,
  itemId: string,
  previousQuantity: number,
  nextQuantity: number,
): Promise<void> {
  if (previousQuantity <= 0 || nextQuantity > 0) return;

  const existing = await db.notification.findFirst({
    where: { inventoryItemId: itemId, kind: "OUT_OF_STOCK", dismissedAt: null },
  });
  if (existing) return;

  await db.notification.create({
    data: { householdId, kind: "OUT_OF_STOCK", inventoryItemId: itemId },
  });

  // Fire-and-forget: some callers run this inside a $transaction (see this
  // function's doc comment above), and awaiting a push network call there
  // would hold it open. See sendPushToHousehold's doc comment in
  // src/lib/push.ts for why that's an acceptable trade.
  const item = await db.inventoryItem.findUnique({ where: { id: itemId }, select: { name: true } });
  if (item) {
    void sendPushToHousehold(householdId, {
      title: "Out of stock",
      body: `${item.name} is out of stock`,
      url: "/dashboard/inventory?status=out",
    });
  }
}

// Finds past meal-plan entries that were never marked cooked and files a
// one-time reminder for each — a nudge that "mark as cooked" was probably
// forgotten. The `mealPlanEntryId` unique constraint on Notification makes
// the create idempotent (a concurrent request racing this same sync is a
// no-op via P2002), and guarantees each entry only ever gets one reminder,
// dismissed or not.
async function syncMealNotLoggedNotifications(householdId: string): Promise<void> {
  const today = new Date(toDateKey(new Date()));

  const candidates = await prisma.mealPlanEntry.findMany({
    where: {
      mealPlan: { householdId },
      date: { lt: today },
      consumedAt: null,
      notification: null,
    },
    select: { id: true, date: true, freeformName: true, recipe: { select: { name: true } } },
  });
  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map((entry) =>
      prisma.notification
        .create({
          data: { householdId, kind: "MEAL_NOT_LOGGED", mealPlanEntryId: entry.id },
        })
        .then(() => {
          // Fire-and-forget — see recordOutOfStockTransition's matching
          // comment above and sendPushToHousehold's doc comment in
          // src/lib/push.ts.
          const name = entry.recipe?.name ?? entry.freeformName ?? "";
          void sendPushToHousehold(householdId, {
            title: "Did you forget to log a meal?",
            body: name || "A planned meal was never marked as cooked",
            url: `/dashboard/meal-planning?week=${toDateKey(getWeekStart(entry.date))}`,
          });
        })
        .catch((error) => {
          // P2002: another concurrent sync already created it — fine, ignore.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
          throw error;
        }),
    ),
  );
}

export async function getActiveNotifications(householdId: string): Promise<NotificationItem[]> {
  await syncMealNotLoggedNotifications(householdId);

  const rows = await prisma.notification.findMany({
    where: { householdId, dismissedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      inventoryItem: { select: { name: true } },
      mealPlanEntry: {
        select: { date: true, freeformName: true, recipe: { select: { name: true } } },
      },
    },
  });

  return rows.flatMap((row): NotificationItem[] => {
    if (row.kind === "OUT_OF_STOCK") {
      // The item was deleted after the alert fired (onDelete: Cascade would
      // normally remove this row too, but a concurrent transaction could
      // leave a brief gap) — nothing meaningful to show.
      if (!row.inventoryItem) return [];
      return [{ id: row.id, kind: "outOfStock", itemId: row.inventoryItemId!, name: row.inventoryItem.name }];
    }

    if (!row.mealPlanEntry) return [];
    const entryDate = row.mealPlanEntry.date;
    return [
      {
        id: row.id,
        kind: "mealNotLogged",
        entryId: row.mealPlanEntryId!,
        dateKey: toDateKey(entryDate),
        weekStartKey: toDateKey(getWeekStart(entryDate)),
        name: row.mealPlanEntry.recipe?.name ?? row.mealPlanEntry.freeformName ?? "",
      },
    ];
  });
}
