"use server";

// MAINT-3: the shopping-list lifecycle (create / rename / archive / delete,
// generate from low stock, complete / uncomplete) split out of the old
// actions.ts, same shape as meal-planning's split. Item edits are in
// item-actions.ts, ticking and put-away in purchase-actions.ts.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { INTERACTIVE_TX_OPTIONS } from "@/lib/db-transaction";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { datedName, format, plural } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { getStockStatus } from "@/lib/stock-status";
import { getOrCreateDefaultShoppingList } from "@/lib/shopping/default-list";
import { resolveTemplateRows } from "@/lib/shopping/list-templates";
import { categoryKey } from "@/lib/shopping/shopping-mode-grouping";
import { learnFromCheckOffs, parseLearnedOrder, type CheckOff } from "@/lib/shopping/store-order";
import { loadIncomingByItem, coveredQuantity } from "@/lib/incoming-stock";
import { defaultLineEstimate } from "@/lib/shopping/unit-price";
import { LoggedExpense, logGroceriesExpense, formatExpenseLogged } from "./expense-log";
import { updateItemPriceSchema } from "./price-schema";

const createListSchema = z.object({
  name: z.string().trim().max(120, v("listNameTooLong")).optional(),
  // UX-85: "blank", "template:<id>" or "list:<id>", what the New list sheet
  // starts the list from. Split by hand below so a malformed value falls back
  // to a blank list instead of failing the whole form; a well-formed one
  // whose source isn't found in the household is an error.
  start: z.string().optional(),
  // Only read for "list:<id>": copy just what's still to buy, or every row.
  items: z.enum(["unbought", "all"]).optional(),
});

const renameListSchema = z.object({
  listId: z.string().min(1),
  name: z.string().trim().min(1, v("nameRequired")).max(120, v("listNameTooLong")),
});

type CopiedRow = {
  name: string;
  quantity: number;
  unit: string;
  inventoryItemId: string | null;
  note?: string | null;
};

/**
 * Source rows to ShoppingListItem create data for a fresh list. The same
 * inventory re-linking a template uses (resolveTemplateRows), so a copied
 * row whose inventory item was since deleted links again by name or alias.
 * Rows start unticked; a copied note rides along.
 */
async function rowsForNewList(householdId: string, source: CopiedRow[]) {
  if (source.length === 0) return [];
  const [inventoryItems, aliases] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { householdId },
      select: { id: true, name: true, unit: true, lastKnownPrice: true },
    }),
    prisma.itemAlias.findMany({
      where: { householdId },
      select: { normalizedName: true, inventoryItemId: true },
    }),
  ]);
  return resolveTemplateRows(source, inventoryItems, aliases).map((row, i) => ({
    ...row,
    ...(source[i].note ? { note: source[i].note } : {}),
  }));
}

export async function createShoppingListAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = createListSchema.safeParse({
    name: formData.get("name") || undefined,
    start: formData.get("start") || undefined,
    items: formData.get("items") || undefined,
  });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const dict = await getDictionary();
  const start = parsed.data.start ?? "blank";
  const colon = start.indexOf(":");
  const kind = colon === -1 ? start : start.slice(0, colon);
  const sourceId = colon === -1 ? "" : start.slice(colon + 1);

  let list;
  try {
    let name = parsed.data.name;
    let rows: Awaited<ReturnType<typeof rowsForNewList>> = [];

    if (kind === "template" && sourceId) {
      const template = await prisma.shoppingListTemplate.findFirst({
        where: { id: sourceId, householdId: household.id },
        include: { items: { orderBy: { position: "asc" } } },
      });
      if (!template) return await fail("templateNotFound");
      name ||= template.name;
      rows = await rowsForNewList(household.id, template.items);
    } else if (kind === "list" && sourceId) {
      // Scoped by household, so another household's list id finds nothing.
      const source = await prisma.shoppingList.findFirst({
        where: { id: sourceId, householdId: household.id },
        include: {
          items: {
            where: parsed.data.items === "all" ? {} : { purchased: false },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!source) return await fail("shoppingListNotFound");
      rows = await rowsForNewList(household.id, source.items);
    }

    list = await prisma.shoppingList.create({
      data: {
        householdId: household.id,
        name: name || datedName(dict.shoppingList.defaultNamePrefix, await getLocale()),
        ...(rows.length > 0 ? { items: { create: rows } } : {}),
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  redirect(`/dashboard/shopping-list/${list.id}`);
}

/**
 * UX-85: rename a list from its ⋯ menu or by tapping its title. Works on any
 * status (a finished trip is often renamed to what it was) and leaves
 * `isDefault` alone, so "Next shop" keeps filling itself under whatever name
 * the household gives it.
 */
export async function renameShoppingListAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = renameListSchema.safeParse({
    listId: formData.get("listId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return await zodFail(parsed.error);

  try {
    const { count } = await prisma.shoppingList.updateMany({
      where: { id: parsed.data.listId, householdId: household.id },
      data: { name: parsed.data.name },
    });
    if (count === 0) return await fail("shoppingListNotFound");
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${parsed.data.listId}`);
  return {};
}

export async function archiveShoppingListAction(listId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    // Archiving the default list un-defaults it (AUTO-8): unarchive always
    // returns a list to ACTIVE, and an old default coming back alongside the
    // current one would break "at most one ACTIVE default" (and trip the
    // partial unique index). The next auto-add lazily starts a fresh one.
    await prisma.shoppingList.updateMany({
      where: { id: listId, householdId: household.id },
      data: { status: "ARCHIVED", archivedAt: new Date(), isDefault: false },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${listId}`);
  return {};
}

export async function unarchiveShoppingListAction(listId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.shoppingList.updateMany({
      where: { id: listId, householdId: household.id, status: "ARCHIVED" },
      data: { status: "ACTIVE", archivedAt: null },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${listId}`);
  return {};
}

export async function deleteShoppingListAction(listId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.shoppingList.deleteMany({
      where: { id: listId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  redirect("/dashboard/shopping-list");
}

export async function generateFromLowStockAction(
  listId: string,
): Promise<ActionState & { added?: number }> {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return await fail("listNotEditable");

  let added = 0;
  try {
    const lowStockItems = await prisma.inventoryItem.findMany({
      where: { householdId: household.id },
    });

    const alreadyOnList = await prisma.shoppingListItem.findMany({
      where: { shoppingListId: list.id, purchased: false, inventoryItemId: { not: null } },
      select: { inventoryItemId: true },
    });
    const alreadyOnListIds = new Set(alreadyOnList.map((i) => i.inventoryItemId));
    // Stock ticked off but not yet put away counts as covered — see
    // src/lib/incoming-stock.ts. Without it, pressing this while the last
    // trip's bags are still on the counter would re-list everything in them.
    const incoming = await loadIncomingByItem(prisma, household.id, new Date());

    const toAdd = lowStockItems.filter(
      (item) =>
        getStockStatus(coveredQuantity(item.quantity, incoming.get(item.id) ?? 0), item.lowStockThreshold) !== "in" &&
        !alreadyOnListIds.has(item.id),
    );

    if (toAdd.length > 0) {
      await prisma.shoppingListItem.createMany({
        data: toAdd.map((item) => ({
          shoppingListId: list.id,
          inventoryItemId: item.id,
          name: item.name,
          quantity: Math.max(1, item.lowStockThreshold - item.quantity),
          unit: item.unit,
          addedAutomatically: true,
          // AUTO-4: same last-known-price default as the ad-hoc add path.
          estimatedPrice: defaultLineEstimate(item.lastKnownPrice, Math.max(1, item.lowStockThreshold - item.quantity)),
        })),
      });
      added = toAdd.length;
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  return { added };
}

/**
 * AUTO-9: folds one finished trip's check-off sequence into the household's
 * learned store order (see store-order.ts for the EMA itself). Only rows
 * ticked off by hand carry a checkedOffAt, so receipt-applied rows, rows
 * ticked before the column existed and anything un-ticked again simply
 * aren't part of the sequence. A trip that touched fewer than two
 * categories teaches nothing and writes nothing.
 *
 * Best-effort on purpose: the list is already completed by the time this
 * runs, so a failure here is logged and reported (toFriendlyError) but never
 * turns a successful "Done shopping" into an error toast. `learned` is the
 * value requireHousehold loaded at the start of the request; two members
 * completing lists in the same instant can lose one trip's nudge, which a
 * moving average shrugs off.
 */
async function learnStoreOrder(
  householdId: string,
  learned: unknown,
  items: { checkedOffAt: Date | null; inventoryItem: { category: string } | null }[],
) {
  const checkOffs: CheckOff[] = items.flatMap((item) =>
    item.checkedOffAt ? [{ key: categoryKey(item.inventoryItem?.category ?? null), at: item.checkedOffAt }] : [],
  );
  const next = learnFromCheckOffs(parseLearnedOrder(learned), checkOffs);
  if (!next) return;
  try {
    await prisma.household.update({ where: { id: householdId }, data: { categoryOrderLearned: next } });
  } catch (error) {
    await toFriendlyError(error);
  }
}

/**
 * Finishes a trip: status COMPLETED, AUTO-9's store-order learning, and the
 * Groceries expense. Deliberately leaves inventory alone, including rows
 * that are ticked but not yet put away (put-away mode): putting those away
 * here, at the list's quantities, would book stock nobody confirmed —
 * exactly what the put-away step exists to avoid. Instead the list page
 * routes "Done shopping" through PutAwayDialog whenever such rows exist
 * (put away and finish, or finish and put away later), and a row left
 * waiting isn't lost: it stays incoming on the completed list, where the
 * "Put away" button and the reminder still find it.
 *
 * UX-80: with `carryOver`, the rows nobody bought move to the household's
 * active default list (the fresh one when this list was the default, a new
 * one when there's none), in the same transaction as the status change, so
 * they show as pending there instead of sitting forgotten on a closed list.
 * A row whose inventory item is already pending on the target stays behind
 * rather than doubling up, the same dedupe the low-stock auto-add uses.
 */
export async function completeShoppingListAction(
  listId: string,
  /** UX-87: the amount the user confirmed in the "some items have no price"
   * step. Omitted = the sum of the priced purchased rows (the old
   * behaviour); `null` = the user chose to log nothing; a number replaces
   * the sum (the user corrected it to the real total). Validated like a
   * price, since it ends up in the budget. */
  amountOverride?: number | null,
  /** UX-80: move the unbought rows to the next active list. */
  carryOver?: boolean,
): Promise<{
  expenseLoggedMessage?: string;
  /** Rows carried over, for the toast ("Moved 2 to Next shop") and for
   * uncompleteShoppingListAction to put back exactly those. */
  carriedOver?: { itemIds: string[]; listId: string; listName: string };
  unresolvedNotice?: string;
  /** The Groceries expense this completion logged, if any — handed back to
   * uncompleteShoppingListAction by the toast's "Undo" (AUTO-5) so it
   * removes exactly that row and nothing else. */
  transactionId?: string;
  error?: string;
}> {
  const { household, userId } = await requireHousehold();

  if (amountOverride != null) {
    const parsedAmount = updateItemPriceSchema.safeParse({ price: amountOverride });
    if (!parsedAmount.success) return await zodFail(parsedAmount.error);
  }

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
    // The linked item's category rides along for AUTO-9's store-order
    // learning below — it's the category a row was grouped under.
    include: { items: { include: { inventoryItem: { select: { category: true } } } } },
  });
  if (!list) return {};

  const dict = await getDictionary();

  // Completing no longer requires every item to be mapped to an inventory
  // item first — that used to block finishing the list at exactly the
  // moment (in the store, or just home) the user wants to be done. An
  // unlinked item was never going to update inventory anyway (see
  // togglePurchasedAction/applyReceiptScanAction, both no-ops without
  // item.inventoryItem), so nothing about the actual data changes here —
  // this only relaxes the completion gate, surfacing a heads-up afterward
  // instead of a hard stop. Items stay resolvable anytime via the "needs
  // mapping" row UI (ShoppingItemFormDialog's edit mode / linkShoppingListItemAction /
  // createInventoryItemFromShoppingListItemAction in item-actions.ts / batch resolution
  // via resolveShoppingListMappingsAction in smart-add-actions.ts), completed list or not.
  const unresolvedCount = list.items.filter((item) => item.inventoryItemId === null).length;

  // Completing the default list (AUTO-8) hands the role straight to a
  // fresh, empty one, so there's always a "Next shop" to fill — the next
  // low-stock crossing after a shop shouldn't have to wait for a list to be
  // made. `isDefault` is cleared on the completed list first (same
  // transaction) so the partial unique index never sees two ACTIVE defaults
  // and a later un-archive can't resurrect a second one.
  // Log an expense for whatever purchased items actually have an estimated
  // price set — never invent/estimate a price for items that don't.
  let groceriesTotal = 0;
  for (const item of list.items) {
    if (item.purchased && item.estimatedPrice != null) {
      groceriesTotal += item.estimatedPrice;
    }
  }
  // UX-87: the client asked about a partial total (some bought rows have no
  // price) and the user either corrected the amount or chose not to log one.
  // logGroceriesExpense logs nothing for 0.
  if (amountOverride !== undefined) groceriesTotal = amountOverride ?? 0;

  // Status change and expense commit together (MAINT-5), so a list is never
  // COMPLETED without the expense its prices add up to, or the other way round.
  let expense: LoggedExpense | null;
  let carriedOver: { itemIds: string[]; listId: string; listName: string } | undefined;
  try {
    expense = await prisma.$transaction(async (tx) => {
      await tx.shoppingList.update({
        where: { id: list.id },
        data: { status: "COMPLETED", completedAt: new Date(), ...(list.isDefault ? { isDefault: false } : {}) },
      });
      const nextDefault = list.isDefault ? await getOrCreateDefaultShoppingList(tx, household.id) : null;

      const unbought = carryOver ? list.items.filter((item) => !item.purchased) : [];
      if (unbought.length > 0) {
        const target = nextDefault ?? (await getOrCreateDefaultShoppingList(tx, household.id));
        const alreadyThere = await tx.shoppingListItem.findMany({
          where: {
            shoppingListId: target.id,
            purchased: false,
            inventoryItemId: { in: unbought.flatMap((item) => (item.inventoryItemId ? [item.inventoryItemId] : [])) },
          },
          select: { inventoryItemId: true },
        });
        const dupes = new Set(alreadyThere.map((row) => row.inventoryItemId));
        const moving = unbought.filter((item) => !item.inventoryItemId || !dupes.has(item.inventoryItemId));
        if (moving.length > 0) {
          await tx.shoppingListItem.updateMany({
            where: { id: { in: moving.map((item) => item.id) }, shoppingListId: list.id, purchased: false },
            data: { shoppingListId: target.id },
          });
          carriedOver = { itemIds: moving.map((item) => item.id), listId: target.id, listName: target.name };
        }
      }

      return logGroceriesExpense(tx, {
        householdId: household.id,
        userId,
        amount: groceriesTotal,
        description: format(dict.shoppingList.expenseDescription, { name: list.name }),
      });
    }, INTERACTIVE_TX_OPTIONS);
  } catch (error) {
    return toFriendlyError(error);
  }

  await learnStoreOrder(household.id, household.categoryOrderLearned, list.items);

  const transactionId = expense?.transactionId;
  const expenseLoggedMessage = expense
    ? await formatExpenseLogged(dict.shoppingList.expenseLogged, household.currencyCode, expense)
    : undefined;

  const unresolvedNotice =
    unresolvedCount > 0
      ? format(plural(unresolvedCount, dict.shoppingList.unresolvedNotice), { count: unresolvedCount })
      : undefined;

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/budget");
  if (carriedOver) revalidatePath(`/dashboard/shopping-list/${carriedOver.listId}`);

  return { expenseLoggedMessage, unresolvedNotice, transactionId, carriedOver };
}

/**
 * The "Undo" on the "Done shopping" toast (AUTO-5): puts a just-completed
 * list back to ACTIVE and removes the Groceries expense that completion
 * logged, identified by the id completeShoppingListAction returned — never
 * "the latest Groceries expense", which could be someone else's. Same
 * short-lived, fat-finger-only shape as undoMarkMealEntryCookedAction, not
 * a permanent "reopen list" control. Idempotent: a list that's no longer
 * COMPLETED (a double-tapped Undo, or it was archived meanwhile) is left
 * alone, and the expense delete is a household-scoped deleteMany, so a
 * stale or foreign id removes nothing. Inventory needs no reversal —
 * completing never touched it (stock moves when each item is checked off,
 * or put away in put-away mode, and neither is undone here; a row still
 * waiting to be put away simply keeps waiting on the reopened list).
 *
 * UX-80: `carriedItemIds` are the rows completion moved to the next list;
 * they come back, but only those still unticked and still in this
 * household, so a row someone already bought on the new list stays there.
 */
export async function uncompleteShoppingListAction(
  listId: string,
  transactionId?: string,
  carriedItemIds?: string[],
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id },
    select: { id: true, status: true },
  });
  if (!list) return await fail("listNotFound");
  if (list.status !== "COMPLETED") return {};

  try {
    await prisma.$transaction(async (tx) => {
      await tx.shoppingList.update({
        where: { id: list.id },
        data: { status: "ACTIVE", completedAt: null },
      });
      if (transactionId) {
        await tx.transaction.deleteMany({
          where: { id: transactionId, householdId: household.id },
        });
      }
      if (carriedItemIds && carriedItemIds.length > 0) {
        await tx.shoppingListItem.updateMany({
          where: {
            id: { in: carriedItemIds },
            purchased: false,
            shoppingList: { householdId: household.id },
          },
          data: { shoppingListId: list.id },
        });
      }
    }, INTERACTIVE_TX_OPTIONS);
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath("/dashboard/budget");
  return {};
}
