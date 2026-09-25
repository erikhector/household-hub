// Persisted alerts for the notification bell (nav — see
// `src/components/notifications/`). Backed by the `Notification` table (see
// its doc comment in prisma/schema.prisma) — unlike the fully live-computed
// design this replaced, alerts are created once, at the moment a trigger
// condition happens, and stick around until a user dismisses them (see
// dismissNotificationAction in src/lib/actions/notifications.ts).
//
// Five triggers exist:
// - Out-of-stock: an existing InventoryItem's quantity crossing from > 0
//   into <= 0 — see `recordOutOfStockTransition`, called from every action
//   that can *decrease* an existing item's quantity (adjustQuantityAction,
//   markItemEmptyAction, updateInventoryItemAction, bulkUpdateFieldAction,
//   markMealEntryCookedAction, togglePurchasedAction). Deliberately never
//   called from anything that *creates* an item (createInventoryItemAction,
//   quickAddInventoryItemAction, addStarterKitItemsAction,
//   findOrCreateInventoryItem, createInventoryItemFromShoppingListItemAction)
//   — those items often start at quantity 0, which is not a depletion event.
//   Every one of those call sites also runs AUTO-8's sibling
//   `addToDefaultListOnLowStock` (src/lib/shopping/default-list.ts), which
//   fires one step earlier — on the crossing into *low* — and puts the item
//   on the household's default list instead of raising an alert.
// - Meal not logged: a past MealPlanEntry whose `consumedAt` is still null —
//   synced by `syncMealNotLoggedNotifications` below, run for every
//   household by the `/api/cron/sync-notifications` route (see that route's
//   file) on a schedule, not on the read path. It used to run inline inside
//   `getActiveNotifications` on every bell fetch, which meant opening the
//   bell could trigger an unbounded number of writes and push sends on what
//   should've been a pure read. User-facing effect of the change: a new
//   alert now appears with a delay of up to the cron interval (see
//   DEPLOYMENT.md's "Scheduled jobs" section) instead of instantly on the
//   next bell-open.
// - Expiring soon: an in-stock InventoryItem with `expiresAt` set, within
//   EXPIRY_WARNING_DAYS of that date or already past it — synced by
//   `syncExpiringSoonNotifications` below, on the same cron schedule as
//   meal-not-logged.
// - List cleared (good news): a ShoppingList's unpurchased item count
//   crossing from >0 to 0 — see `recordListClearedTransition`, called from
//   togglePurchasedAction and deleteShoppingListItemAction (and their
//   share-link equivalents).
// - Price spike (GAP-9): a price just written to PriceHistory that's
//   materially above that item's trailing median per unit — see
//   `recordPriceSpikes` below, called after the transaction commits from
//   every action that writes PriceHistory (togglePurchasedAction,
//   toggleItemViaShareTokenAction, applyReceiptScanAction,
//   registerReceiptAction). The decision itself is the pure
//   `detectPriceSpike` (src/lib/price-spike.ts).
//
// There used to be another, good-news "restocked" trigger (the inverse of
// out-of-stock, firing when an item crossed back above its low-stock
// threshold) — removed by product decision; nobody wanted a notification for
// that. `RESTOCKED` still exists as a `NotificationKind` enum value (see
// prisma/schema.prisma) purely so any rows already in the database keep
// deserializing; nothing creates new ones and `getActiveNotifications` below
// no longer surfaces them.
//
// Callers must resolve `householdId` from their own `requireHousehold()`
// call first — this trusts its argument the same way
// `findOrCreateInventoryItem`/`findOrCreateGroceriesCategory` do.
//
// Every trigger below that stems from a specific user action (as opposed to
// the lazy background syncs, which have no single actor) takes an optional
// `actingUserId` and passes it through to `sendPushToHousehold` as the user
// to exclude — by product decision, the person who just performed the
// action that caused the notification shouldn't be pushed a notification
// about their own action; their other household members still get it.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getWeekStart, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { sendPushToHousehold } from "@/lib/push";
import { EXPIRY_WARNING_DAYS } from "@/lib/inventory/expiry";
import { logger } from "@/lib/logger";
import {
  PRICE_SPIKE_COOLDOWN_DAYS,
  PRICE_SPIKE_MAX_AGE_DAYS,
  detectPriceSpike,
  type PricePoint,
} from "@/lib/price-spike";

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

export type ExpiringSoonNotification = {
  id: string;
  kind: "expiringSoon";
  itemId: string;
  name: string;
  // AUTO-7: the item's expiry is a shelf-life estimate, not a date the
  // household actually entered — the bell softens its wording for these
  // ("probably", see notification-bell.tsx's notificationLabel) rather than
  // stating a guess as fact.
  estimated: boolean;
};

export type ListClearedNotification = {
  id: string;
  kind: "listCleared";
  shoppingListId: string;
  name: string;
};

export type PriceSpikeNotification = {
  id: string;
  kind: "priceSpike";
  itemId: string;
  name: string;
  // Null only if a row somehow lacks it; the bell then drops the number
  // rather than the alert.
  increasePercent: number | null;
};

export type NotificationItem =
  | OutOfStockNotification
  | MealNotLoggedNotification
  | ExpiringSoonNotification
  | ListClearedNotification
  | PriceSpikeNotification;

// A history-list entry: the same shape as the bell's NotificationItem, plus
// the timestamps the notification center page needs to show "when" and
// whether it's still unread — `getActiveNotifications` below has no need for
// either since it only ever returns undismissed rows.
export type NotificationHistoryItem = NotificationItem & {
  createdAt: Date;
  dismissedAt: Date | null;
};

type DbClient = typeof prisma | Prisma.TransactionClient;

type NotificationRow = Prisma.NotificationGetPayload<{
  include: {
    inventoryItem: { select: { name: true; expiresAtEstimated: true } };
    mealPlanEntry: { select: { date: true; freeformName: true; recipe: { select: { name: true } } } };
    shoppingList: { select: { name: true } };
  };
}>;

// Shared by getActiveNotifications and getNotificationHistory below — maps
// one Notification row (with its related-record names already joined in) to
// the discriminated-union shape the bell and the history page both render.
// Returns [] for a row whose related record is gone (see the inline comments
// this replaces) or a retired RESTOCKED row (see this file's top doc comment).
function toNotificationItem(row: NotificationRow): NotificationItem[] {
  if (row.kind === "OUT_OF_STOCK") {
    if (!row.inventoryItem) return [];
    return [{ id: row.id, kind: "outOfStock", itemId: row.inventoryItemId!, name: row.inventoryItem.name }];
  }

  if (row.kind === "EXPIRING_SOON") {
    if (!row.inventoryItem) return [];
    return [
      {
        id: row.id,
        kind: "expiringSoon",
        itemId: row.inventoryItemId!,
        name: row.inventoryItem.name,
        estimated: row.inventoryItem.expiresAtEstimated,
      },
    ];
  }

  if (row.kind === "RESTOCKED") return [];

  if (row.kind === "PRICE_SPIKE") {
    if (!row.inventoryItem) return [];
    return [
      {
        id: row.id,
        kind: "priceSpike",
        itemId: row.inventoryItemId!,
        name: row.inventoryItem.name,
        increasePercent: row.priceIncreasePercent,
      },
    ];
  }

  if (row.kind === "LIST_CLEARED") {
    if (!row.shoppingList) return [];
    return [{ id: row.id, kind: "listCleared", shoppingListId: row.shoppingListId!, name: row.shoppingList.name }];
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
}

const notificationRowInclude = {
  inventoryItem: { select: { name: true, expiresAtEstimated: true } },
  mealPlanEntry: {
    select: { date: true, freeformName: true, recipe: { select: { name: true } } },
  },
  shoppingList: { select: { name: true } },
} satisfies Prisma.NotificationInclude;

// Every notification ever recorded for the household, dismissed or not — the
// notification center page's data source (see
// src/app/dashboard/notifications/page.tsx). Doesn't sync the background
// kinds itself — that's the `/api/cron/sync-notifications` route's job now,
// not any page's read path (see this file's top doc comment). Capped at 200
// rows — a household generating more than that is not a case worth
// paginating for yet.
export async function getNotificationHistory(householdId: string): Promise<NotificationHistoryItem[]> {
  const rows = await prisma.notification.findMany({
    where: { householdId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: notificationRowInclude,
  });

  return rows.flatMap((row): NotificationHistoryItem[] =>
    toNotificationItem(row).map((item) => ({ ...item, createdAt: row.createdAt, dismissedAt: row.dismissedAt })),
  );
}

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
  actingUserId?: string,
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
    void sendPushToHousehold(
      householdId,
      {
        title: "Out of stock",
        body: `${item.name} is out of stock`,
        url: "/dashboard/inventory?status=out",
      },
      actingUserId,
    );
  }
}

// Fires when a ShoppingList's unpurchased item count crosses from >0 to 0 —
// "the shopping is done" (see docs/archive/JOY_GAP_BACKLOG.md item 4). Takes the
// before/after pending counts rather than re-querying them, since every
// caller already knows both from the mutation it just made. Deduped like
// recordOutOfStockTransition so re-triggering while already at 0 (e.g.
// deleting an already-purchased item) or while an undismissed alert is
// still active is a no-op; dismissing it lets the next clearing fire a
// fresh one.
export async function recordListClearedTransition(
  db: DbClient,
  householdId: string,
  shoppingListId: string,
  previousPendingCount: number,
  nextPendingCount: number,
  actingUserId?: string,
): Promise<void> {
  if (previousPendingCount === 0 || nextPendingCount !== 0) return;

  const existing = await db.notification.findFirst({
    where: { shoppingListId, kind: "LIST_CLEARED", dismissedAt: null },
  });
  if (existing) return;

  await db.notification.create({
    data: { householdId, kind: "LIST_CLEARED", shoppingListId },
  });

  // Fire-and-forget — see recordOutOfStockTransition's matching comment
  // above and sendPushToHousehold's doc comment in src/lib/push.ts.
  const list = await db.shoppingList.findUnique({ where: { id: shoppingListId }, select: { name: true } });
  if (list) {
    void sendPushToHousehold(
      householdId,
      {
        title: "Shopping list cleared",
        body: `${list.name} is all checked off`,
        url: `/dashboard/shopping-list/${shoppingListId}`,
      },
      actingUserId,
    );
  }
}

// One PriceHistory row an action just wrote — its id so the row itself is
// left out of the history it's compared against, plus the line's
// quantity/unit for the per-unit comparison (see detectPriceSpike).
export type RecordedPrice = {
  priceHistoryId: string;
  inventoryItemId: string;
  price: number;
  quantity: number;
  unit: string;
};

/**
 * GAP-9: files a PRICE_SPIKE alert for every item in `recorded` whose new
 * price is materially above its usual one (the rules are detectPriceSpike's,
 * src/lib/price-spike.ts). Called by every action that writes PriceHistory,
 * with everything it wrote in one go, *after* its transaction has committed
 * rather than inside it:
 * - the comparison needs to see the item's committed history, and a failed
 *   write must never leave an alert behind for a price that was rolled back;
 * - receipt scans write their rows in parallel inside one transaction, where
 *   a per-row findFirst-then-create dedupe could interleave and let two
 *   lines for the same item both pass the check. Taking the whole batch at
 *   once and grouping by item means one receipt yields at most one decision
 *   (and one alert) per item, however many lines name it.
 *
 * Deduped per item two ways: an undismissed PRICE_SPIKE for it (same as
 * recordOutOfStockTransition), or *any* PRICE_SPIKE for it created within
 * PRICE_SPIKE_COOLDOWN_DAYS, dismissed or not — un-checking and re-checking
 * the same purchase writes a second PriceHistory row at the same price, and
 * without the cooldown dismissing the first alert would just invite an
 * identical second one. Quiet hours need nothing here: sendPushToHousehold
 * applies them to every push.
 *
 * Never throws — the prices are already saved, so a failure here is logged
 * and swallowed rather than turned into an error for a purchase that
 * actually succeeded. The push is awaited, like the cron syncs' (there's no
 * transaction left to hold open, and awaiting means a serverless platform
 * can't freeze the invocation before the send goes out).
 *
 * Callers must resolve `householdId` from their own requireHousehold() (or,
 * for the share link, from the list the token resolved) — the item lookup
 * below is scoped to it, so a foreign item id is silently skipped.
 */
export async function recordPriceSpikes(
  householdId: string,
  recorded: RecordedPrice[],
  actingUserId?: string,
): Promise<void> {
  if (recorded.length === 0) return;

  try {
    const now = new Date();
    const itemIds = [...new Set(recorded.map((row) => row.inventoryItemId))];

    const [items, priorRows, recentAlerts] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { id: { in: itemIds }, householdId },
        select: { id: true, name: true },
      }),
      // Only rows detectPriceSpike can actually use: within its age cap and
      // carrying quantity/unit (pre-GAP-9 rows don't). Household-scoped
      // through the item, like the cost analyzer's read (PriceHistory has no
      // householdId of its own).
      prisma.priceHistory.findMany({
        where: {
          inventoryItemId: { in: itemIds },
          inventoryItem: { householdId },
          id: { notIn: recorded.map((row) => row.priceHistoryId) },
          date: { gte: new Date(now.getTime() - PRICE_SPIKE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) },
          quantity: { not: null },
          unit: { not: null },
        },
        select: { inventoryItemId: true, price: true, quantity: true, unit: true, date: true },
      }),
      prisma.notification.findMany({
        where: {
          householdId,
          kind: "PRICE_SPIKE",
          inventoryItemId: { in: itemIds },
          OR: [
            { dismissedAt: null },
            { createdAt: { gte: new Date(now.getTime() - PRICE_SPIKE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) } },
          ],
        },
        select: { inventoryItemId: true },
      }),
    ]);

    const suppressed = new Set(recentAlerts.map((row) => row.inventoryItemId));
    const priorByItem = new Map<string, PricePoint[]>();
    for (const row of priorRows) {
      const list = priorByItem.get(row.inventoryItemId) ?? [];
      list.push(row);
      priorByItem.set(row.inventoryItemId, list);
    }

    await Promise.all(
      items
        .filter((item) => !suppressed.has(item.id))
        .map(async (item) => {
          const spike = detectPriceSpike(
            priorByItem.get(item.id) ?? [],
            recorded
              .filter((row) => row.inventoryItemId === item.id)
              .map((row) => ({ price: row.price, quantity: row.quantity, unit: row.unit, date: now })),
            now,
          );
          if (!spike) return;

          await prisma.notification.create({
            data: {
              householdId,
              kind: "PRICE_SPIKE",
              inventoryItemId: item.id,
              priceIncreasePercent: spike.increasePercent,
            },
          });

          await sendPushToHousehold(
            householdId,
            {
              title: "Price jump",
              body: `${item.name} cost ${spike.increasePercent}% more than usual`,
              url: "/dashboard/budget?tab=insights",
            },
            actingUserId,
          );
        }),
    );
  } catch (error) {
    logger.error("Failed to record price-spike notifications", { householdId, error });
  }
}

// Finds past meal-plan entries that were never marked cooked and files a
// one-time reminder for each — a nudge that "mark as cooked" was probably
// forgotten. The `mealPlanEntryId` unique constraint on Notification makes
// the create idempotent (a concurrent request racing this same sync is a
// no-op via P2002), and guarantees each entry only ever gets one reminder,
// dismissed or not.
//
// Exported for `/api/cron/sync-notifications` (the only caller — see this
// file's top doc comment for why this isn't run from getActiveNotifications
// on the read path anymore).
export async function syncMealNotLoggedNotifications(householdId: string): Promise<void> {
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
    candidates.map(async (entry) => {
      try {
        await prisma.notification.create({
          data: { householdId, kind: "MEAL_NOT_LOGGED", mealPlanEntryId: entry.id },
        });
      } catch (error) {
        // P2002: another concurrent sync already created it — fine, ignore.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
        throw error;
      }

      // Awaited — unlike recordOutOfStockTransition/recordListClearedTransition
      // (which fire-and-forget because some of their callers run inside a
      // Prisma $transaction; see sendPushToHousehold's doc comment in
      // src/lib/push.ts), this function only ever runs from
      // `/api/cron/sync-notifications`, outside any transaction. A Route
      // Handler's response is sent as soon as its GET resolves, and the
      // underlying serverless invocation can be frozen/killed right after —
      // an un-awaited push here could simply never go out. Awaiting it
      // costs nothing (there's no transaction to hold open) and guarantees
      // the send is attempted before the cron run reports success.
      const name = entry.recipe?.name ?? entry.freeformName ?? "";
      await sendPushToHousehold(householdId, {
        title: "Did you forget to log a meal?",
        body: name || "A planned meal was never marked as cooked",
        url: `/dashboard/meal-planning?week=${toDateKey(getWeekStart(entry.date))}`,
      });
    }),
  );
}

// Finds in-stock items within EXPIRY_WARNING_DAYS of their `expiresAt` (or
// already past it) and files a one-time alert for each — deduped like
// recordOutOfStockTransition (an existing undismissed alert for the same
// item is left alone) rather than a DB unique constraint, since an item can
// legitimately be re-stocked with a new expiry date after an old alert was
// dismissed, and a unique constraint on `inventoryItemId` would then block
// the new one from ever being created.
//
// AUTO-7: deliberately doesn't filter out estimated dates (`expiresAtEstimated`)
// — a shelf-life guess is still useful enough to warn about, per the design
// brief's recommended option, just softened to "probably" for both the push
// copy here and the bell's own wording (see ExpiringSoonNotification.estimated,
// notification-bell.tsx's notificationLabel).
//
// Exported for `/api/cron/sync-notifications` (the only caller — see this
// file's top doc comment for why this isn't run from getActiveNotifications
// on the read path anymore).
export async function syncExpiringSoonNotifications(householdId: string): Promise<void> {
  const threshold = new Date(Date.now() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.inventoryItem.findMany({
    where: {
      householdId,
      quantity: { gt: 0 },
      expiresAt: { lte: threshold },
    },
    select: { id: true, name: true, expiresAtEstimated: true },
  });
  if (candidates.length === 0) return;

  const alreadyAlerted = await prisma.notification.findMany({
    where: {
      householdId,
      kind: "EXPIRING_SOON",
      dismissedAt: null,
      inventoryItemId: { in: candidates.map((item) => item.id) },
    },
    select: { inventoryItemId: true },
  });
  const alreadyAlertedIds = new Set(alreadyAlerted.map((row) => row.inventoryItemId));

  const toAlert = candidates.filter((item) => !alreadyAlertedIds.has(item.id));
  if (toAlert.length === 0) return;

  await Promise.all(
    toAlert.map(async (item) => {
      await prisma.notification.create({ data: { householdId, kind: "EXPIRING_SOON", inventoryItemId: item.id } });

      // Awaited, not fire-and-forget — see syncMealNotLoggedNotifications's
      // matching comment above: this function only ever runs from
      // `/api/cron/sync-notifications`, outside any transaction, so there's
      // no reason not to wait for the send before the cron run reports
      // success (and every reason to, since a Route Handler's underlying
      // invocation can be frozen/killed right after the response is sent).
      await sendPushToHousehold(householdId, {
        title: "Expiring soon",
        body: item.expiresAtEstimated ? `${item.name} is probably expiring soon` : `${item.name} is expiring soon`,
        url: "/dashboard/inventory",
      });
    }),
  );
}

// The bell's data source (src/app/dashboard/layout.tsx) — a pure read, no
// writes or push sends. The MEAL_NOT_LOGGED/EXPIRING_SOON background syncs
// that used to run inline here on every call now run only from
// `/api/cron/sync-notifications` on a schedule; see this file's top doc
// comment for why, including the resulting user-facing delay.
export async function getActiveNotifications(householdId: string): Promise<NotificationItem[]> {
  const rows = await prisma.notification.findMany({
    where: { householdId, dismissedAt: null },
    orderBy: { createdAt: "desc" },
    include: notificationRowInclude,
  });

  return rows.flatMap(toNotificationItem);
}
