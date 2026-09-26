// Pure rules for the two-phase "in the cart, then put away" flow (see
// Household.inventorySyncMode and ShoppingListItem.putAwayAt in
// prisma/schema.prisma, and "Put away" in REQUIREMENTS.md). Nothing here
// touches the database, so both Server Actions and Client Components (the
// shopping list's put-away button and receipt row picker) can share them,
// and the unit tests need no mocks.

import { INCOMING_MAX_AGE_DAYS, incomingSince } from "@/lib/incoming-stock";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Whether ticking a row should wait for the put-away step rather than update
 * inventory itself. Anything but an explicit ON_PUT_AWAY means "no": that's
 * the original behaviour, and the safe reading of a household row loaded
 * without the column.
 */
export function defersToPutAway(household: { inventorySyncMode?: string | null }): boolean {
  return household.inventorySyncMode === "ON_PUT_AWAY";
}

type PutAwayState = { purchased: boolean; putAwayAt?: Date | null };

/** Ticked, and its stock not yet counted into inventory. */
export function isAwaitingPutAway(row: PutAwayState): boolean {
  return row.purchased && row.putAwayAt === null;
}

/**
 * Whether a receipt line may still be matched to this row. An unticked row
 * always can (that's the original receipt flow). A ticked row can only while
 * nothing about the purchase has been recorded yet — not put away (its stock
 * would be counted twice) and no receipt price already written (its
 * PriceHistory would be). Strict `=== null` on purpose: a row selected
 * without these columns (undefined) reads as "already handled", never as
 * fair game.
 */
export function awaitsReceiptPrice(row: PutAwayState & { priceRecordedAt?: Date | null }): boolean {
  if (!row.purchased) return true;
  return row.putAwayAt === null && row.priceRecordedAt === null;
}

// How long after the tick a trip is assumed to be home. Long enough that
// nobody is nagged in the car park or while unpacking; short enough that
// the reminder still lands the same day. The cron that sends it runs on its
// own schedule (DEPLOYMENT.md, "Scheduled jobs"), so this is the earliest
// a reminder can go out, not the exact moment.
export const PUT_AWAY_REMINDER_DELAY_HOURS = 3;

export type ReminderRow = {
  checkedOffAt: Date | null;
  /** A receipt applied in put-away mode marks rows bought without a tick;
   * this is then when that happened (see incomingSince). */
  priceRecordedAt?: Date | null;
  checkedOffByUserId: string | null;
};

export type ReminderList = {
  id: string;
  name: string;
  putAwayRemindedAt: Date | null;
  /** The list's rows that are ticked and not yet put away. */
  awaiting: ReminderRow[];
};

export type PutAwayReminder = {
  listId: string;
  listName: string;
  /** Every row still waiting on the list, not just the ones that triggered
   * the reminder — it's the number the dialog will show. */
  count: number;
  /** Who ticked the rows that triggered it, or null when any of them has no
   * known ticker (a share-link visitor, or a pre-existing row), in which case
   * the whole household is reminded. */
  recipientUserIds: string[] | null;
};

/**
 * Which lists earn a "Put away your shopping?" reminder right now. A row
 * triggers one when it was ticked at least PUT_AWAY_REMINDER_DELAY_HOURS ago
 * but within INCOMING_MAX_AGE_DAYS (after that it's no longer treated as
 * incoming either, so there's nothing left to remind about), and after the
 * list's last reminder. That last rule is what makes it "once per trip":
 * the default list lives across many shops, so a flag that stayed set after
 * the first reminder would silence every later trip, while one reminder per
 * cron run would nag. A row is dated the same way incoming stock is
 * (incomingSince): its tick, else when a receipt priced it — so a receipt
 * applied at home and then forgotten is reminded about like a tick would be.
 * Its recipient is `checkedOffByUserId`, which receipt apply fills with
 * whoever applied it.
 */
export function selectPutAwayReminders(lists: readonly ReminderList[], now: Date): PutAwayReminder[] {
  const dueBefore = now.getTime() - PUT_AWAY_REMINDER_DELAY_HOURS * HOUR_MS;
  const notBefore = now.getTime() - INCOMING_MAX_AGE_DAYS * DAY_MS;

  return lists.flatMap((list) => {
    const lastReminder = list.putAwayRemindedAt?.getTime() ?? -Infinity;
    const triggering = list.awaiting.filter((row) => {
      const since = incomingSince({ checkedOffAt: row.checkedOffAt, priceRecordedAt: row.priceRecordedAt ?? null });
      if (!since) return false;
      const at = since.getTime();
      return at <= dueBefore && at >= notBefore && at > lastReminder;
    });
    if (triggering.length === 0) return [];

    const tickers = new Set<string>();
    let anyUnknown = false;
    for (const row of triggering) {
      if (row.checkedOffByUserId) tickers.add(row.checkedOffByUserId);
      else anyUnknown = true;
    }

    return [
      {
        listId: list.id,
        listName: list.name,
        count: list.awaiting.length,
        recipientUserIds: anyUnknown ? null : [...tickers].sort(),
      },
    ];
  });
}
