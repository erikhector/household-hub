"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { fail, toFriendlyError } from "@/lib/actions/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { recordListClearedTransition, recordPriceSpikes, type RecordedPrice } from "@/lib/notifications";
import { revalidateAutoAdded, type AutoAddedItem } from "@/lib/shopping/default-list";
import { applyStockArrival, reverseStockArrival } from "@/lib/shopping/put-away";
import { defersToPutAway } from "@/lib/shopping/put-away-calc";
import { parseLearnedOrder, type StoreOrder } from "@/lib/shopping/store-order";

// Genuinely unauthenticated actions reached via the token-only public page at
// src/app/share/shopping-list/[token]/page.tsx — there is no session on this
// path at all (no requireHousehold call anywhere below), by product
// decision: the token itself IS the credential, same frictionless model as
// /join/[token]. See REQUIREMENTS.md's shopping-list "Share link" subsection
// for the full permissions model.
//
// The critical security boundary in this file is
// toggleItemViaShareTokenAction re-validating that the itemId the client
// sent actually belongs to the specific ShoppingList this token points at —
// never trust a client pairing a valid token with an arbitrary itemId from a
// *different* list (or household). Every lookup below re-derives the list
// from the token first, then scopes the item query to that list's id, the
// same "always re-derive the tenant boundary server-side" shape
// requireHousehold()-scoped actions use, just with the token standing in for
// the session.

// SEC-13: the same throttle, with the same constants, as the calendar feed
// (src/app/api/calendar/[token]/route.ts), for the same reason: with no
// session, a leaked or guessed link would otherwise be a free way to hammer
// the database, and the toggle also moves inventory stock. Keyed on the
// token rather than the caller's IP, so switching networks doesn't reset it.
//
// Reads and toggles get separate buckets. Every toggle already costs a read
// as well (its revalidatePath re-renders the share page in the action's
// response), so one shared bucket would halve how many items a shopper
// could tick in an hour. This way a trip can tick about 120 items an hour,
// well past any real list.
const SHARE_LIST_RATE_LIMIT = 120;
const SHARE_LIST_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

async function findActiveShareLink(token: string) {
  return prisma.shoppingListShareLink.findUnique({
    where: { token },
  });
}

export type SharedShoppingListItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  purchased: boolean;
  // GAP-5: shown to link holders too — "get the ripe ones" is written for
  // exactly whoever ends up doing the shopping, which is often the person
  // the list was shared with.
  note: string | null;
  // UX-63: the linked inventory item's category, so the share page can group
  // by aisle like the member view. null for an unlinked row.
  category: string | null;
};

export type SharedShoppingList = {
  id: string;
  name: string;
  // UX-63: "Shared by {household}". The link holder sees this much of the
  // household and no more (no member names, no ids).
  householdName: string;
  // UX-63: the household's store order (AUTO-9), for the aisle grouping.
  storeOrder: StoreOrder;
  items: SharedShoppingListItem[];
};

/**
 * Public lookup for the share page itself. Returns null for an unknown
 * token OR a revoked one (indistinguishable to the visitor — there's no
 * reason to leak which) so the page can render a single "not found or
 * revoked" state.
 */
export async function getShoppingListByShareToken(token: string): Promise<SharedShoppingList | null> {
  // Over the cap reads the same as a dead link: the page has one "not found
  // or revoked" state, and a real visitor only gets here by reloading far
  // more than any shopping trip needs.
  if (!(await checkRateLimit(`share-list:${token}`, SHARE_LIST_RATE_LIMIT, SHARE_LIST_RATE_LIMIT_WINDOW_MS))) {
    return null;
  }

  const shareLink = await findActiveShareLink(token);
  if (!shareLink || shareLink.revokedAt) return null;

  const list = await prisma.shoppingList.findUnique({
    where: { id: shareLink.shoppingListId },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      household: { select: { name: true, categoryOrderLearned: true, categoryOrderManual: true } },
    },
  });
  if (!list) return null;

  // UX-63: a row's category lives on its linked inventory item. Scoped to the
  // list's own household, so a row can never surface another one's category.
  const linkedIds = list.items.flatMap((item) => (item.inventoryItemId ? [item.inventoryItemId] : []));
  const linked = linkedIds.length
    ? await prisma.inventoryItem.findMany({
        where: { id: { in: linkedIds }, householdId: list.householdId },
        select: { id: true, category: true },
      })
    : [];
  const categoryById = new Map(linked.map((row) => [row.id, row.category]));

  return {
    id: list.id,
    name: list.name,
    householdName: list.household.name,
    storeOrder: {
      learned: parseLearnedOrder(list.household.categoryOrderLearned),
      manual: list.household.categoryOrderManual,
    },
    items: list.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      purchased: item.purchased,
      note: item.note ?? null,
      category: item.inventoryItemId ? (categoryById.get(item.inventoryItemId) ?? null) : null,
    })),
  };
}

/**
 * Unauthenticated equivalent of togglePurchasedAction
 * (src/app/dashboard/shopping-list/actions.ts) — replicates its exact side
 * effects, just reached via a share token instead of requireHousehold():
 * flip `purchased` and stamp `checkedOffAt` (AUTO-9); then, by the list's
 * household's `inventorySyncMode`, either leave the stock for the put-away
 * step (ON_PUT_AWAY) or apply the arrival straight away and stamp
 * `putAwayAt` (ON_CHECK — quantity, AUTO-7 expiry, GAP-28 opened-reset,
 * PriceHistory, the out-of-stock and AUTO-8 hooks, all via
 * applyStockArrival). Un-ticking a row that was already put away reverses
 * its stock; one that wasn't has nothing to reverse. `checkedOffByUserId`
 * stays null — a link holder has no account — so the put-away reminder for
 * their ticks goes to the whole household. See this file's top doc comment
 * for why the itemId/token pairing check below is the actual security
 * boundary, not optional defensive dressing.
 */
export async function toggleItemViaShareTokenAction(
  token: string,
  itemId: string,
): Promise<{ error?: string }> {
  if (
    !(await checkRateLimit(`share-list-toggle:${token}`, SHARE_LIST_RATE_LIMIT, SHARE_LIST_RATE_LIMIT_WINDOW_MS))
  ) {
    return { error: (await getDictionary()).sharedShoppingList.rateLimited };
  }

  const shareLink = await findActiveShareLink(token);
  if (!shareLink || shareLink.revokedAt) {
    return await fail("shareLinkInvalid");
  }

  // Scoped to shareLink.shoppingListId, not just "any item with this id" —
  // this is what stops a visitor from taking a valid token for list A and
  // pairing it with an itemId from list B (their own, or guessed/enumerated)
  // to toggle an item they were never granted access to.
  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingListId: shareLink.shoppingListId },
    include: { inventoryItem: true },
  });
  if (!item) return await fail("itemNotFound");

  const nextPurchased = !item.purchased;

  let autoAdded: AutoAddedItem | null = null;
  // GAP-9: same post-commit price-spike check as togglePurchasedAction. No
  // acting user to exclude from the push — a share-link visitor has no
  // account, so every household member hears about it.
  let householdId = null as string | null;
  const recordedPrices: RecordedPrice[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const list = await tx.shoppingList.findUnique({
        where: { id: item.shoppingListId },
        select: { householdId: true, household: { select: { inventorySyncMode: true } } },
      });
      const arrivesNow = nextPurchased && !!list && !defersToPutAway(list.household ?? {});
      const reversesArrival = !nextPurchased && item.putAwayAt !== null;
      const now = new Date();

      await tx.shoppingListItem.update({
        where: { id: item.id },
        // AUTO-9: whoever holds the share link is often the one walking
        // the store, so their ticks teach the store order too — same
        // set/clear as togglePurchasedAction.
        data: nextPurchased
          ? {
              purchased: true,
              checkedOffAt: now,
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

      if (list && item.inventoryItem && arrivesNow) {
        const arrival = await applyStockArrival(tx, {
          householdId: list.householdId,
          inventoryItem: item.inventoryItem,
          quantity: item.quantity,
          unit: item.unit,
          price: item.estimatedPrice,
        });
        // Same auto-add as the signed-in toggle, but with no toast/Undo:
        // a share-link visitor has no session to undo with, and the row
        // is still marked "added automatically" for the household to see.
        autoAdded = arrival.autoAdded;
        if (arrival.recordedPrice) {
          householdId = list.householdId;
          recordedPrices.push(arrival.recordedPrice);
        }
      } else if (list && item.inventoryItem && reversesArrival) {
        const reversal = await reverseStockArrival(tx, {
          householdId: list.householdId,
          inventoryItem: item.inventoryItem,
          quantity: item.quantity,
        });
        autoAdded = reversal.autoAdded;
      }

      if (list && nextPurchased) {
        const remainingPending = await tx.shoppingListItem.count({
          where: { shoppingListId: item.shoppingListId, purchased: false },
        });
        await recordListClearedTransition(tx, list.householdId, item.shoppingListId, remainingPending + 1, remainingPending);
      }
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  if (householdId) recordPriceSpikes(householdId, recordedPrices);

  revalidatePath(`/share/shopping-list/${token}`);
  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidateAutoAdded([autoAdded]);

  return {};
}
