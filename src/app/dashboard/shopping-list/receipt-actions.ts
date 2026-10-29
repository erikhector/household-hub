"use server";

// MAINT-3: receipt scan and manual receipt registration, split out of the
// old actions.ts.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { datedName, format, plural } from "@/lib/i18n/format";
import { HOUSEHOLD_BASE_CURRENCY } from "@/lib/currency";
import { fetchExchangeRate } from "@/lib/exchange-rate";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { recordPriceSpikes, type RecordedPrice } from "@/lib/notifications";
import { createCategoryResolver, scheduleAiCategoryFallback } from "@/lib/inventory/category-resolver";
import { estimatedExpiryUpdate } from "@/lib/inventory/shelf-life";
import { frozenResetOnArrival, openedResetOnArrival } from "@/lib/inventory/expiry";
import { applyStockArrival } from "@/lib/shopping/put-away";
import { awaitsReceiptPrice, defersToPutAway } from "@/lib/shopping/put-away-calc";
import type { InventoryItem } from "@/generated/prisma/client";
import { unitPriceOf } from "@/lib/shopping/unit-price";
import { findExactInventoryItem, findFuzzyInventoryItem } from "./inventory-lookup";
import { LoggedExpense, logGroceriesExpense, formatExpenseLogged } from "./expense-log";

export type ReceiptScanMatch = {
  shoppingListItemId: string;
  /** What the receipt line cost in total (the line's amount, not per unit). */
  price: number;
  /** BUG-3: how many the receipt line was for ("3 x Milk 45,00" is 3).
   * Omitted (or unusable) means the list row's own quantity, which is what
   * the price was always assumed to cover. It can differ from the row's:
   * the row says "Milk x1", the receipt says three. */
  quantity?: number;
};

/**
 * Applies a reviewed receipt scan (see ReceiptScanDialog) to a shopping
 * list: for every matched line, converts its price to
 * HOUSEHOLD_BASE_CURRENCY if the receipt was in a different currency, sets
 * that as the item's estimatedPrice, and marks it purchased — mirroring
 * togglePurchasedAction's side effects for the household's
 * `inventorySyncMode`, just batched across every scanned line in one
 * transaction instead of one checkbox at a time. In ON_CHECK mode that's
 * the full arrival (stock, expiry, PriceHistory) and the row is put away;
 * in ON_PUT_AWAY mode only the price is recorded and the stock waits for
 * the put-away step.
 *
 * A line can match a row that hasn't been ticked yet, or — the usual way
 * round in put-away mode, where people tick in the store and scan at home —
 * one that's ticked but not yet put away and has no price recorded (see
 * awaitsReceiptPrice). A row already counted into inventory never matches
 * again, so a receipt can't add the same carton twice.
 *
 * Only ever receives the OCR'd text/numbers the client already extracted
 * (see receipt-parsing.ts) — the receipt photo itself never reaches the
 * server, same privacy stance as the barcode scanner
 * (src/components/shared/barcode-scanner.tsx).
 *
 * `store` (GAP-6) is one optional name for the whole receipt — a receipt is
 * from a single store, so there's no per-line field for it — stamped onto
 * every PriceHistory row this writes. `PriceHistory.store` has existed in
 * the schema since AUTO-9's groundwork, but this is the first write path
 * that ever populates it; left blank, rows are written exactly as before
 * (store: null).
 */
export async function applyReceiptScanAction(
  listId: string,
  currency: string,
  matches: ReceiptScanMatch[],
  store?: string,
): Promise<ActionState & { itemsUpdated?: number; totalAmount?: number }> {
  const { household, userId } = await requireHousehold();
  const trimmedStore = store?.trim().slice(0, 120) || null;

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
    include: { items: { include: { inventoryItem: true } } },
  });
  if (!list) return await fail("listNotEditable");

  const itemsById = new Map(list.items.map((item) => [item.id, item]));
  // Belt-and-braces de-dupe: if the client ever sent the same shopping-list
  // item twice (e.g. two OCR'd lines both matched to it), only the first is
  // applied — otherwise it would be double-counted into inventory and
  // PriceHistory below.
  const seen = new Set<string>();
  const validMatches = matches.filter((m) => {
    if (seen.has(m.shoppingListItemId)) return false;
    const item = itemsById.get(m.shoppingListItemId);
    if (!item || !Number.isFinite(m.price) || m.price <= 0) return false;
    if (!awaitsReceiptPrice(item)) return false;
    seen.add(m.shoppingListItemId);
    return true;
  });
  if (validMatches.length === 0) return await fail("nothingToApply");

  let rate = 1;
  if (currency.toUpperCase() !== HOUSEHOLD_BASE_CURRENCY) {
    const fetched = await fetchExchangeRate(currency, HOUSEHOLD_BASE_CURRENCY);
    if (fetched === null) {
      return await fail("exchangeRateUnavailable", { currency: currency, base: HOUSEHOLD_BASE_CURRENCY });
    }
    rate = fetched;
  }

  // Put-away mode: the receipt says what was paid, not that anything is in
  // the cupboard yet, so the rows are marked bought with their real price
  // and left for the put-away step to move the stock. The price itself is a
  // fact right now, so PriceHistory (with the store) and lastKnownPrice are
  // written here and `priceRecordedAt` tells the put-away not to write them
  // again. `priceRecordedAt` means exactly "a PriceHistory row was written
  // for this line", so an unlinked row (no PriceHistory possible) never gets
  // it — instead it's put away on the spot, since there's no stock to wait
  // for either, which is also what stops it staying matchable forever.
  const deferStock = defersToPutAway(household);

  let totalAmount = 0;
  let itemsUpdated = 0;
  // GAP-9: every PriceHistory row written below, checked for price spikes
  // as one batch after the transaction commits — see recordPriceSpikes for
  // why that's after, and batched, rather than per row inside it.
  const recordedPrices: RecordedPrice[] = [];

  // Sequential, not Promise.all (SCALE-C used to run these in parallel):
  // two lines can land on the same inventory item (the same product on the
  // list twice), and parallel writes from one stale snapshot would lose one
  // line's stock. Each line re-reads its row and item inside the
  // transaction after claiming the row, so the second line builds on the
  // first. A receipt is a few dozen lines, so the extra hold time is small.
  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      for (const match of validMatches) {
        const item = itemsById.get(match.shoppingListItemId)!;
        const convertedPrice = Math.round(match.price * rate * 100) / 100;
        // BUG-3: the receipt's own count when it gave one, else the row's. The
        // price stays the row's estimate as paid (the Groceries expense sums
        // it), but PriceHistory and lastKnownPrice are per unit of *this*
        // quantity: 45 for 3 is 15 each, not 45 for the row's one.
        const priceQuantity =
          match.quantity !== undefined && Number.isFinite(match.quantity) && match.quantity > 0
            ? match.quantity
            : item.quantity;

        // Claimed only while it's still waiting for a price (the
        // transactional twin of awaitsReceiptPrice), so a put-away or a
        // second receipt that got there first wins and this line is skipped
        // instead of counting the stock or the price again.
        const claimed = await tx.shoppingListItem.updateMany({
          where: {
            id: item.id,
            shoppingListId: list.id,
            OR: [{ purchased: false }, { putAwayAt: null, priceRecordedAt: null }],
          },
          data: {
            estimatedPrice: convertedPrice,
            purchased: true,
            // Whoever applied the receipt gets the put-away reminder for rows
            // nobody ticked by hand.
            ...(deferStock && !item.purchased ? { checkedOffByUserId: userId } : {}),
          },
        });
        if (claimed.count === 0) continue;
        itemsUpdated++;
        totalAmount += convertedPrice;

        const row = await tx.shoppingListItem.findUnique({
          where: { id: item.id },
          include: { inventoryItem: true },
        });
        if (!row) continue;
        const linked = row.inventoryItem !== null;
        await tx.shoppingListItem.update({
          where: { id: row.id },
          data: {
            ...(linked ? { priceRecordedAt: now } : {}),
            ...(!deferStock || !linked ? { putAwayAt: now } : {}),
          },
        });
        if (!row.inventoryItem) continue;

        if (deferStock) {
          // AUTO-4: a scanned receipt price is as real as it gets, so it
          // becomes the item's new lastKnownPrice even before the stock
          // itself is put away.
          await tx.inventoryItem.update({
            where: { id: row.inventoryItem.id },
            data: { lastKnownPrice: unitPriceOf(convertedPrice, priceQuantity) },
          });
          const history = await tx.priceHistory.create({
            data: {
              inventoryItemId: row.inventoryItem.id,
              price: convertedPrice,
              quantity: priceQuantity,
              unit: row.unit,
              store: trimmedStore,
            },
          });
          recordedPrices.push({
            priceHistoryId: history.id,
            inventoryItemId: row.inventoryItem.id,
            price: convertedPrice,
            quantity: priceQuantity,
            unit: row.unit,
          });
          continue;
        }

        // A matched receipt line is stock arriving, same as a tick in
        // ON_CHECK mode: AUTO-7's estimate, GAP-28's fresh-pack reset,
        // AUTO-4's lastKnownPrice and GAP-9's PriceHistory all come from
        // applyStockArrival.
        const arrival = await applyStockArrival(tx, {
          householdId: household.id,
          actingUserId: userId,
          inventoryItem: row.inventoryItem,
          quantity: row.quantity,
          unit: row.unit,
          price: convertedPrice,
          priceQuantity,
          store: trimmedStore,
        });
        if (arrival.recordedPrice) recordedPrices.push(arrival.recordedPrice);
      }
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  recordPriceSpikes(household.id, recordedPrices, userId);

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/budget");

  return { itemsUpdated, totalAmount };
}

export type ReceiptRegistrationItem = {
  name: string;
  quantity: number;
  unit?: string;
  price: number;
  /** Inventory item the user explicitly matched this line to in the review
   * step (RegisterReceiptDialog's "Use existing" mode) — takes priority
   * over the exact/fuzzy auto-match fallback below. */
  inventoryItemId?: string;
  /** Set (possibly to "") when the user explicitly chose "Create new" for
   * this line, so a fresh InventoryItem is created with this category
   * instead of falling back to a fuzzy auto-match. */
  newItemCategory?: string;
};

const registerReceiptItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Mirrors importItemsSchema/updateItemPriceSchema's caps — a hand-typed
  // receipt line has no legitimate reason to be this large.
  quantity: z.coerce.number().min(0.01).max(100_000),
  unit: z.string().trim().max(20).optional(),
  price: z.coerce.number().min(0.01).max(1_000_000, v("priceTooLarge")),
  inventoryItemId: z.string().trim().min(1).optional(),
  newItemCategory: z.string().trim().max(60).optional(),
});

const registerReceiptSchema = z.object({
  name: z.string().trim().max(120).optional(),
  currency: z.string().trim().min(1).max(10),
  // GAP-6: optional, one store for the whole receipt — see
  // applyReceiptScanAction's doc comment for why this is per-receipt.
  store: z.string().trim().max(120).optional(),
  // 300 mirrors importItemsSchema/bulkCreateSchema's cap on bulk item rows.
  items: z.array(registerReceiptItemSchema).min(1, v("addAtLeastOneItem")).max(300, v("tooManyItems")),
});

/**
 * "Register receipt" — the alternative entry point to ReceiptScanDialog /
 * applyReceiptScanAction above for when there's no shopping list yet to
 * match scanned lines against: building that list by hand first, just to
 * immediately scan a receipt against it, is the tedious round trip this
 * skips. Instead this creates the list from the receipt itself, one already-
 * purchased item per reviewed line, and completes it in the same call — the
 * same end state completeShoppingListAction reaches (a logged Groceries
 * expense, an unresolved-items count) but reached in one step instead of
 * create → add → check off → complete.
 *
 * Each line's inventory link follows what the user chose in
 * RegisterReceiptDialog's review step (mirroring ResolveMappingsDialog's
 * existing/new toggle): `inventoryItemId` when they picked a suggested or
 * manually-chosen existing item, `newItemCategory` when they chose to
 * create a new one (created here, same shape as createAdHocShoppingListItem's
 * newItemDetails path). Neither set falls back to the old silent exact/fuzzy
 * auto-match, kept only for callers that predate the review step.
 *
 * Inventory matches/creates are resolved up front (before the transaction
 * below, which only performs writes). Quantity deltas are accumulated per
 * inventory item first so two receipt lines naming the same item don't
 * clobber each other by both computing their new quantity from the same
 * stale snapshot.
 */
export async function registerReceiptAction(
  listName: string | undefined,
  currency: string,
  items: ReceiptRegistrationItem[],
  store?: string,
): Promise<
  ActionState & {
    listId?: string;
    itemsAdded?: number;
    totalAmount?: number;
    expenseLoggedMessage?: string;
    unresolvedNotice?: string;
  }
> {
  const { household, userId } = await requireHousehold();
  const dict = await getDictionary();

  const parsed = registerReceiptSchema.safeParse({ name: listName, currency, store, items });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }
  const trimmedStore = parsed.data.store || null;

  const upperCurrency = parsed.data.currency.toUpperCase();
  let rate = 1;
  if (upperCurrency !== HOUSEHOLD_BASE_CURRENCY) {
    const fetched = await fetchExchangeRate(upperCurrency, HOUSEHOLD_BASE_CURRENCY);
    if (fetched === null) {
      return await fail("exchangeRateUnavailable", { currency: upperCurrency, base: HOUSEHOLD_BASE_CURRENCY });
    }
    rate = fetched;
  }

  const finalListName =
    parsed.data.name ||
    datedName(dict.shoppingList.registerReceipt.namePlaceholderPrefix, await getLocale());

  const preparedItems: {
    name: string;
    quantity: number;
    unit: string;
    convertedPrice: number;
    // Widened to the full row (not just id/quantity/unit) so the AUTO-7
    // shelf-life estimate below has the category/shelfLifeDays/expiresAt it
    // needs, without a second fetch per item.
    inventoryItem: InventoryItem | null;
  }[] = [];
  let totalAmount = 0;
  let unresolvedCount = 0;
  const resolveCategory = createCategoryResolver(household.id);
  // PERF-16: the household's inventory, loaded on the first line that needs
  // a fuzzy match (a receipt whose lines are all linked or explicitly new
  // costs no read) and matched in memory after that. Items this receipt
  // creates are added so a later line can still fuzzy-match them, as it did
  // when each line re-read the table. Keyed by id: a line that created an
  // item *before* the lazy load is already in the read's result, and a
  // duplicate candidate would make a single confident match look ambiguous
  // (findFuzzyInventoryItem leaves a two-way tie unlinked).
  let fuzzyCandidates: Map<string, InventoryItem> | null = null;
  const createdThisReceipt: InventoryItem[] = [];
  // AUTO-2b(a): every "add as new item" line whose guess misses is a
  // candidate for the AI fallback, scheduled (batched) once every line has
  // been processed below.
  const aiCandidates: string[] = [];

  for (const line of parsed.data.items) {
    let inventoryItem: InventoryItem | null = null;

    if (line.inventoryItemId) {
      inventoryItem = await prisma.inventoryItem.findFirst({
        where: { id: line.inventoryItemId, householdId: household.id },
      });
    } else if (line.newItemCategory !== undefined) {
      const guessed = line.newItemCategory || (await resolveCategory(line.name));
      if (!guessed) aiCandidates.push(line.name);
      inventoryItem = await prisma.inventoryItem.create({
        data: {
          householdId: household.id,
          name: line.name,
          category: guessed || "Uncategorized",
          unit: line.unit || "pcs",
          quantity: 0,
          lowStockThreshold: 0,
        },
      });
      createdThisReceipt.push(inventoryItem);
      fuzzyCandidates?.set(inventoryItem.id, inventoryItem);
    } else {
      inventoryItem = await findExactInventoryItem(household.id, line.name);
      if (!inventoryItem) {
        if (!fuzzyCandidates) {
          const loaded = await prisma.inventoryItem.findMany({ where: { householdId: household.id } });
          fuzzyCandidates = new Map([...loaded, ...createdThisReceipt].map((item) => [item.id, item]));
        }
        inventoryItem = await findFuzzyInventoryItem(household.id, line.name, [...fuzzyCandidates.values()]);
      }
    }
    if (!inventoryItem) unresolvedCount++;

    const convertedPrice = Math.round(line.price * rate * 100) / 100;
    totalAmount += convertedPrice;

    preparedItems.push({
      name: line.name,
      quantity: line.quantity,
      unit: line.unit || inventoryItem?.unit || "pcs",
      convertedPrice,
      inventoryItem,
    });
  }
  // Every inventory item above is already committed independently of the
  // transaction below, so scheduling the fallback here doesn't need to wait
  // on (or be undone by) anything that happens afterward.
  if (aiCandidates.length > 0) scheduleAiCategoryFallback(household.id, aiCandidates);

  // AUTO-4: also tracks each inventory item's most recently seen receipt
  // price so it can become lastKnownPrice below — a receipt line's price is
  // as real as it gets. When two lines on the same receipt name the same
  // item at different prices (a discount line, a typo'd re-entry), the last
  // one in the list wins, same as it would if they'd been two separate
  // purchases.
  const inventoryDeltas = new Map<
    string,
    { currentQuantity: number; delta: number; lastKnownPrice: number; item: InventoryItem }
  >();
  for (const item of preparedItems) {
    if (!item.inventoryItem) continue;
    const existing = inventoryDeltas.get(item.inventoryItem.id) ?? {
      currentQuantity: item.inventoryItem.quantity,
      delta: 0,
      lastKnownPrice: unitPriceOf(item.convertedPrice, item.quantity),
      item: item.inventoryItem,
    };
    existing.delta += item.quantity;
    // BUG-3: the line's price is for its whole quantity ("3 x Milk 45,00"),
    // lastKnownPrice is per unit of it, so the next "Milk x1" starts at 15.
    existing.lastKnownPrice = unitPriceOf(item.convertedPrice, item.quantity);
    inventoryDeltas.set(item.inventoryItem.id, existing);
  }

  // GAP-9: see applyReceiptScanAction's matching comment.
  const recordedPrices: RecordedPrice[] = [];
  let registered: { listId: string; expense: LoggedExpense | null };
  try {
    registered = await prisma.$transaction(async (tx) => {
      const registeredAt = new Date();
      const list = await tx.shoppingList.create({
        data: {
          householdId: household.id,
          name: finalListName,
          status: "COMPLETED",
          completedAt: registeredAt,
        },
      });

      for (const item of preparedItems) {
        await tx.shoppingListItem.create({
          data: {
            shoppingListId: list.id,
            inventoryItemId: item.inventoryItem?.id ?? null,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            purchased: true,
            estimatedPrice: item.convertedPrice,
            // The receipt is registered after the shop, so the stock is home
            // and counted below in this same transaction — whatever the
            // household's inventorySyncMode, there's nothing left to put
            // away (and nothing for the put-away step to count twice).
            putAwayAt: registeredAt,
            ...(item.inventoryItem ? { priceRecordedAt: registeredAt } : {}),
          },
        });

        if (item.inventoryItem) {
          const row = await tx.priceHistory.create({
            data: {
              inventoryItemId: item.inventoryItem.id,
              price: item.convertedPrice,
              quantity: item.quantity,
              unit: item.unit,
              store: trimmedStore,
            },
          });
          recordedPrices.push({
            priceHistoryId: row.id,
            inventoryItemId: item.inventoryItem.id,
            price: item.convertedPrice,
            quantity: item.quantity,
            unit: item.unit,
          });
        }
      }

      for (const [inventoryItemId, { currentQuantity, delta, lastKnownPrice, item }] of inventoryDeltas) {
        const nextQuantity = currentQuantity + delta;
        // AUTO-7: registering a receipt is a stock-arrival event too — same
        // rule as applyReceiptScanAction/togglePurchasedAction (purchase-actions.ts).
        const expiryUpdate = estimatedExpiryUpdate(item, currentQuantity, nextQuantity);
        // GAP-28: same fresh-pack reset as togglePurchasedAction.
        const openedReset = openedResetOnArrival(item, currentQuantity, nextQuantity);
        // GAP-44: and a restocked frozen item is no longer frozen.
        const frozenReset = frozenResetOnArrival(item, currentQuantity, nextQuantity);
        await tx.inventoryItem.update({
          where: { id: inventoryItemId },
          data: { quantity: nextQuantity, lastKnownPrice, ...openedReset, ...frozenReset, ...expiryUpdate },
        });
      }

      const expense = await logGroceriesExpense(tx, {
        householdId: household.id,
        userId,
        amount: totalAmount,
        description: format(dict.shoppingList.expenseDescription, { name: finalListName }),
      });

      return { listId: list.id, expense };
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  const { listId } = registered;
  recordPriceSpikes(household.id, recordedPrices, userId);

  const expenseLoggedMessage = registered.expense
    ? await formatExpenseLogged(dict.shoppingList.expenseLogged, household.currencyCode, registered.expense)
    : undefined;

  const unresolvedNotice =
    unresolvedCount > 0
      ? format(plural(unresolvedCount, dict.shoppingList.unresolvedNotice), { count: unresolvedCount })
      : undefined;

  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${listId}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/budget");
  revalidatePath("/dashboard");

  return {
    listId,
    itemsAdded: preparedItems.length,
    totalAmount,
    expenseLoggedMessage,
    unresolvedNotice,
  };
}
