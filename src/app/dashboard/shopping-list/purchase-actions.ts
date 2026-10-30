"use server";

// MAINT-3: ticking a row off, replaying an offline tick and the put-away
// step, split out of the old actions.ts.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { INTERACTIVE_TX_OPTIONS } from "@/lib/db-transaction";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { recordListClearedTransition, recordPriceSpikes, type RecordedPrice } from "@/lib/notifications";
import { revalidateAutoAdded, type AutoAddedItem } from "@/lib/shopping/default-list";
import { applyStockArrival, reverseStockArrival } from "@/lib/shopping/put-away";
import { defersToPutAway } from "@/lib/shopping/put-away-calc";

/**
 * Ticks a row off (or back on). What a tick *means* for inventory depends on
 * the household's `inventorySyncMode`:
 *
 * - ON_PUT_AWAY (new households' default): the tick is "it's in the cart".
 *   Only `purchased`/`checkedOffAt`/`checkedOffByUserId` change; the pantry
 *   is updated later, when the row is put away (putAwayItemsAction). Until
 *   then the row is *incoming* stock (src/lib/incoming-stock.ts).
 * - ON_CHECK (every household that predates the put-away step): the tick is
 *   the arrival, exactly as before — applyStockArrival runs straight away
 *   and the row is stamped `putAwayAt` in the same write, so the data reads
 *   the same way whichever mode put it there.
 *
 * Un-ticking is decided by the *row*, not the mode: a row that was already
 * put away gives its stock back (the old un-tick), one that never was has
 * nothing to reverse. That keeps a household that switches modes mid-trip
 * from double-counting or losing anything.
 */
export async function togglePurchasedAction(
  itemId: string,
): Promise<ActionState & { autoAdded?: AutoAddedItem[] }> {
  const { household, userId } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    include: { inventoryItem: true },
  });
  if (!item) return await fail("itemNotFound");

  const nextPurchased = !item.purchased;
  const arrivesNow = nextPurchased && !defersToPutAway(household);
  const reversesArrival = !nextPurchased && item.putAwayAt !== null;

  let autoAdded: AutoAddedItem | null = null;
  // GAP-9: the PriceHistory row this toggle wrote, if any — checked for a
  // price spike once the transaction has committed (see recordPriceSpikes).
  const recordedPrices: RecordedPrice[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.shoppingListItem.update({
        where: { id: item.id },
        // AUTO-9: the tick's timestamp is the whole check-off sequence
        // record — folded into this same row write, so learning the store
        // order costs no extra write per tap. Un-ticking clears it, so an
        // accidental tick never leaves a false step in the sequence, and a
        // re-tick later records when it was actually picked up. Who ticked
        // it rides along so the put-away reminder reaches them.
        data: nextPurchased
          ? {
              purchased: true,
              checkedOffAt: now,
              checkedOffByUserId: userId,
              // ON_CHECK: arrived and counted now; `priceRecordedAt` only
              // when applyStockArrival below really writes a PriceHistory
              // row (linked and priced). Put-away mode: an explicit null
              // putAwayAt, so a row can never enter the cart already
              // looking "put away" whatever state it was left in.
              ...(arrivesNow
                ? {
                    putAwayAt: now,
                    ...(item.inventoryItem && item.estimatedPrice != null ? { priceRecordedAt: now } : {}),
                  }
                : { putAwayAt: null }),
            }
          : // The purchase is undone, and with it the record that its price
            // was taken: a re-tick is a new purchase.
            { purchased: false, checkedOffAt: null, checkedOffByUserId: null, putAwayAt: null, priceRecordedAt: null },
      });

      if (item.inventoryItem && arrivesNow) {
        // AUTO-4: this purchase's price becomes the item's new
        // lastKnownPrice and a PriceHistory row — only when a price was
        // actually set on the row.
        const arrival = await applyStockArrival(tx, {
          householdId: household.id,
          actingUserId: userId,
          inventoryItem: item.inventoryItem,
          quantity: item.quantity,
          unit: item.unit,
          price: item.estimatedPrice,
        });
        autoAdded = arrival.autoAdded;
        if (arrival.recordedPrice) recordedPrices.push(arrival.recordedPrice);
      } else if (item.inventoryItem && reversesArrival) {
        // Only un-checking can decrease stock here. Un-checking a row on the
        // default list itself is a no-op for AUTO-8: that same row is
        // pending again, which is exactly what the dedupe looks for.
        const reversal = await reverseStockArrival(tx, {
          householdId: household.id,
          actingUserId: userId,
          inventoryItem: item.inventoryItem,
          quantity: item.quantity,
        });
        autoAdded = reversal.autoAdded;
      }

      if (nextPurchased) {
        const remainingPending = await tx.shoppingListItem.count({
          where: { shoppingListId: item.shoppingListId, purchased: false },
        });
        await recordListClearedTransition(tx, household.id, item.shoppingListId, remainingPending + 1, remainingPending, userId);
      }
    }, INTERACTIVE_TX_OPTIONS);
  } catch (error) {
    return toFriendlyError(error);
  }
  recordPriceSpikes(household.id, recordedPrices, userId);

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidateAutoAdded([autoAdded]);
  return autoAdded ? { autoAdded: [autoAdded] } : {};
}

const replayTickSchema = z.object({ itemId: z.string().min(1), purchased: z.boolean() });

/**
 * UX-36: saves one tick that was made offline. The queue (see
 * src/lib/shopping/offline-tick-queue.ts) holds what the person wanted the
 * row to be, not a toggle, because the row may have changed since: another
 * member ticked it, or an earlier replay already did. So this only toggles
 * when the row differs from the wish, which makes a replay safe to repeat
 * (last write wins, never a double flip). A row deleted (or from another
 * household, which is indistinguishable) is skipped silently with `{}`,
 * unlike togglePurchasedAction's "Item not found": nobody should be told
 * about an item they can no longer see.
 */
export async function replayTickAction(
  itemId: string,
  purchased: boolean,
): Promise<ActionState & { autoAdded?: AutoAddedItem[] }> {
  const { household } = await requireHousehold();

  const parsed = replayTickSchema.safeParse({ itemId, purchased });
  if (!parsed.success) return await zodFail(parsed.error);

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: parsed.data.itemId, shoppingList: { householdId: household.id } },
    select: { purchased: true },
  });
  if (!item || item.purchased === parsed.data.purchased) return {};

  return await togglePurchasedAction(parsed.data.itemId);
}

export type PutAwayEntry = {
  itemId: string;
  /** "Didn't get it after all": the row is un-ticked instead. */
  notBought?: boolean;
  /** What actually came home; the row's own quantity when left out. */
  quantity?: number;
  /** A native date input's `YYYY-MM-DD`; blank leaves AUTO-7 to estimate. */
  expiresAt?: string;
  /** Where it was put; blank leaves the item's location as it is. */
  location?: string;
};

const putAwaySchema = z.object({
  listId: z.string().min(1),
  entries: z
    .array(
      z.object({
        itemId: z.string().min(1),
        notBought: z.boolean().optional(),
        quantity: z.number().min(0.01, v("quantityPositive")).max(100000).optional(),
        expiresAt: z
          .string()
          .trim()
          .optional()
          .refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), v("invalidDate"))
          .transform((value) => (value ? new Date(value) : null)),
        location: z.string().trim().max(120, v("locationTooLong")).optional(),
      }),
    )
    .min(1, v("nothingToPutAway"))
    .max(300),
});

/**
 * The second half of the two-phase flow: moves ticked rows' stock into
 * inventory now that it's actually home (see togglePurchasedAction for the
 * first half, and Household.inventorySyncMode). Everything the old tick did
 * at arrival happens here instead, via applyStockArrival — the increment
 * (by what the person says came home, which also becomes the row's
 * quantity so a later un-tick gives back the right amount), PriceHistory
 * and lastKnownPrice unless a receipt already recorded them
 * (`priceRecordedAt`), AUTO-7's estimate or the person's own date, GAP-28's
 * opened-reset, the location, and the stock-change hooks — then stamps
 * `putAwayAt`. The price is recorded against the row's listed quantity (what
 * it was paid for), not the corrected one, so the unit price GAP-9 compares
 * stays right. A "not bought" entry un-ticks the row instead (clearing
 * `priceRecordedAt` too), so it goes back to pending rather than counting as
 * bought.
 *
 * Partial on purpose: any subset of the ticked rows can be put away, the
 * rest stay incoming, and the list isn't completed by this. Works on ACTIVE
 * and COMPLETED lists (a finished trip is exactly when there's something to
 * unpack), never ARCHIVED ones.
 *
 * Tenancy: the list must be this household's, and every entry must be a row
 * on that list — a single foreign id fails the whole call rather than being
 * silently dropped, so a forged request can't learn which of its ids were
 * real.
 *
 * Concurrency — what's actually guaranteed: each row is claimed with a
 * conditional write (`purchased AND putAwayAt IS NULL`) inside the
 * transaction, so a row's stock is counted at most once however many
 * members tap "Put away" at the same moment, and a row un-ticked meanwhile
 * is skipped rather than counted. The claim also holds the row's lock until
 * commit, and receipt apply claims its rows the same way, so a receipt and a
 * put-away can't both record the same line's price. Rows are processed one
 * at a time, re-reading the row and its inventory item after the claim, so
 * two rows for the same item add up. What isn't guaranteed: the inventory
 * item itself is re-read and then written with an absolute quantity, like
 * every other stock change in the app, so an unrelated edit of the same
 * item committing in between (someone tapping − at that exact moment) can
 * still be overwritten.
 */
export async function putAwayItemsAction(
  listId: string,
  entries: PutAwayEntry[],
): Promise<ActionState & { putAway?: number; notBought?: number; autoAdded?: AutoAddedItem[] }> {
  const { household, userId } = await requireHousehold();

  const parsed = putAwaySchema.safeParse({ listId, entries });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const list = await prisma.shoppingList.findFirst({
    where: { id: parsed.data.listId, householdId: household.id, status: { in: ["ACTIVE", "COMPLETED"] } },
    select: { id: true },
  });
  if (!list) return await fail("listNotEditable");

  const ids = [...new Set(parsed.data.entries.map((entry) => entry.itemId))];
  // Tenancy only — the transaction below re-reads each row after claiming it.
  const rows = await prisma.shoppingListItem.findMany({
    where: { id: { in: ids }, shoppingListId: list.id },
    select: { id: true },
  });
  if (rows.length !== ids.length) return await fail("itemNotFound");

  // Last entry per row wins, in the order the dialog sent them.
  const entryById = new Map(parsed.data.entries.map((entry) => [entry.itemId, entry]));

  let putAway = 0;
  let notBought = 0;
  const autoAdded: AutoAddedItem[] = [];
  const recordedPrices: RecordedPrice[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();

      for (const [itemId, entry] of entryById) {
        // Claim the row: only a write that still finds it ticked and not
        // put away wins, so of two concurrent put-aways (or a put-away racing
        // an un-tick) exactly one moves its stock. The pre-transaction read
        // above is only for tenancy; everything below re-reads.
        const claimed = await tx.shoppingListItem.updateMany({
          where: { id: itemId, shoppingListId: list.id, purchased: true, putAwayAt: null },
          data: entry.notBought
            ? { purchased: false, checkedOffAt: null, checkedOffByUserId: null, priceRecordedAt: null }
            : { putAwayAt: now },
        });
        if (claimed.count === 0) continue;
        if (entry.notBought) {
          notBought++;
          continue;
        }
        putAway++;

        // Fresh inside the transaction, after the claim: the row's own price
        // state, and the inventory item as it stands after any earlier row
        // in this batch (or anyone else's committed change) touched it.
        const row = await tx.shoppingListItem.findUnique({
          where: { id: itemId },
          include: { inventoryItem: true },
        });
        if (!row) continue;

        const quantity = entry.quantity ?? row.quantity;
        const recordPrice = row.inventoryItem !== null && row.estimatedPrice != null && row.priceRecordedAt === null;
        if (quantity !== row.quantity || recordPrice) {
          await tx.shoppingListItem.update({
            where: { id: row.id },
            data: {
              ...(quantity !== row.quantity ? { quantity } : {}),
              ...(recordPrice ? { priceRecordedAt: now } : {}),
            },
          });
        }

        if (!row.inventoryItem) continue;
        const arrival = await applyStockArrival(tx, {
          householdId: household.id,
          actingUserId: userId,
          inventoryItem: row.inventoryItem,
          quantity,
          unit: row.unit,
          price: recordPrice ? row.estimatedPrice : null,
          // The price was paid for the listed quantity, so that's what its
          // unit price is worked out against — a corrected quantity mustn't
          // look like a price jump (GAP-9).
          priceQuantity: row.quantity,
          expiresAt: entry.expiresAt,
          location: entry.location || null,
        });
        if (arrival.recordedPrice) recordedPrices.push(arrival.recordedPrice);
        if (arrival.autoAdded) autoAdded.push(arrival.autoAdded);
      }

      // Nothing left to unpack on this list: an outstanding reminder about
      // it is now just noise in the bell.
      const stillWaiting = await tx.shoppingListItem.count({
        where: { shoppingListId: list.id, purchased: true, putAwayAt: null },
      });
      if (stillWaiting === 0) {
        await tx.notification.updateMany({
          where: { householdId: household.id, shoppingListId: list.id, kind: "PUT_AWAY_REMINDER", dismissedAt: null },
          data: { dismissedAt: now },
        });
      }
    }, INTERACTIVE_TX_OPTIONS);
  } catch (error) {
    return toFriendlyError(error);
  }
  recordPriceSpikes(household.id, recordedPrices, userId);

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidateAutoAdded(autoAdded);
  return { putAway, notBought, ...(autoAdded.length > 0 ? { autoAdded } : {}) };
}
