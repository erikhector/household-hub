"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { findOrCreateGroceriesCategory } from "@/app/dashboard/budget/actions";
import { HOUSEHOLD_BASE_CURRENCY } from "@/lib/currency";
import { fetchExchangeRate } from "@/lib/exchange-rate";
import type { ActionState } from "@/lib/actions/auth";

/**
 * Case-insensitive exact-name lookup only — never creates. Used wherever a
 * shopping-list item should be auto-linked when it obviously already
 * matches something in inventory, but left unlinked (rather than spawning a
 * near-duplicate item) when it doesn't; the user then resolves it via
 * linkShoppingListItemAction/createInventoryItemFromShoppingListItemAction
 * below (see MapShoppingItemDialog).
 */
async function findExactInventoryItem(householdId: string, name: string) {
  return prisma.inventoryItem.findFirst({
    where: { householdId, name: { equals: name, mode: "insensitive" } },
  });
}

const createListSchema = z.object({
  name: z.string().trim().max(120).optional(),
});

export async function createShoppingListAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = createListSchema.safeParse({ name: formData.get("name") || undefined });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const dict = await getDictionary();
  const list = await prisma.shoppingList.create({
    data: {
      householdId: household.id,
      name:
        parsed.data.name ||
        `${dict.shoppingList.defaultNamePrefix} — ${new Date().toLocaleDateString()}`,
    },
  });

  revalidatePath("/dashboard/shopping-list");
  redirect(`/dashboard/shopping-list/${list.id}`);
}

export async function archiveShoppingListAction(listId: string) {
  const { household } = await requireHousehold();

  await prisma.shoppingList.updateMany({
    where: { id: listId, householdId: household.id },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });

  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${listId}`);
}

export async function unarchiveShoppingListAction(listId: string) {
  const { household } = await requireHousehold();

  await prisma.shoppingList.updateMany({
    where: { id: listId, householdId: household.id, status: "ARCHIVED" },
    data: { status: "ACTIVE", archivedAt: null },
  });

  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${listId}`);
}

export async function deleteShoppingListAction(listId: string) {
  const { household } = await requireHousehold();

  await prisma.shoppingList.deleteMany({
    where: { id: listId, householdId: household.id },
  });

  revalidatePath("/dashboard/shopping-list");
  redirect("/dashboard/shopping-list");
}

export async function generateFromLowStockAction(listId: string) {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return;

  const lowStockItems = await prisma.inventoryItem.findMany({
    where: { householdId: household.id },
  });

  const alreadyOnList = await prisma.shoppingListItem.findMany({
    where: { shoppingListId: list.id, purchased: false, inventoryItemId: { not: null } },
    select: { inventoryItemId: true },
  });
  const alreadyOnListIds = new Set(alreadyOnList.map((i) => i.inventoryItemId));

  const toAdd = lowStockItems.filter(
    (item) => item.quantity <= item.lowStockThreshold && !alreadyOnListIds.has(item.id),
  );

  if (toAdd.length > 0) {
    await prisma.shoppingListItem.createMany({
      data: toAdd.map((item) => ({
        shoppingListId: list.id,
        inventoryItemId: item.id,
        name: item.name,
        quantity: Math.max(1, item.lowStockThreshold - item.quantity),
        addedAutomatically: true,
      })),
    });
  }

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
}

const addItemSchema = z.object({
  listId: z.string().min(1),
  name: z.string().trim().min(1, "Name is required"),
  quantity: z.coerce.number().min(0.01, "Quantity must be greater than 0"),
});

export async function addAdHocItemAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = addItemSchema.safeParse({
    listId: formData.get("listId"),
    name: formData.get("name"),
    quantity: formData.get("quantity") || 1,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const list = await prisma.shoppingList.findFirst({
    where: { id: parsed.data.listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return { error: "This list can't be edited right now" };

  const inventoryItem = await findExactInventoryItem(household.id, parsed.data.name);
  await prisma.shoppingListItem.create({
    data: {
      shoppingListId: list.id,
      inventoryItemId: inventoryItem?.id ?? null,
      name: parsed.data.name,
      quantity: parsed.data.quantity,
    },
  });

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  return {};
}

/**
 * Links a shopping-list item that didn't resolve to an exact inventory-item
 * match (see findExactInventoryItem above) to an existing inventory item the
 * user picked themselves — the "choose an existing item" half of the
 * mapping dialog (MapShoppingItemDialog).
 */
export async function linkShoppingListItemAction(
  itemId: string,
  inventoryItemId: string,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
  });
  if (!item) return { error: "Item not found" };

  const inventoryItem = await prisma.inventoryItem.findFirst({
    where: { id: inventoryItemId, householdId: household.id },
  });
  if (!inventoryItem) return { error: "Inventory item not found" };

  await prisma.shoppingListItem.update({
    where: { id: item.id },
    data: { inventoryItemId: inventoryItem.id },
  });

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  return {};
}

/**
 * Creates a brand-new inventory item from a shopping-list item's name and
 * links it — the explicit "create new item" half of the mapping dialog,
 * replacing the old implicit auto-create in findOrCreateInventoryItem.
 */
export async function createInventoryItemFromShoppingListItemAction(
  itemId: string,
  category: string,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
  });
  if (!item) return { error: "Item not found" };

  const inventoryItem = await prisma.inventoryItem.create({
    data: {
      householdId: household.id,
      name: item.name,
      category: category.trim() || "Uncategorized",
      quantity: 0,
      lowStockThreshold: 0,
    },
  });

  await prisma.shoppingListItem.update({
    where: { id: item.id },
    data: { inventoryItemId: inventoryItem.id },
  });

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/inventory");
  return {};
}

export async function togglePurchasedAction(itemId: string) {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    include: { inventoryItem: true },
  });
  if (!item) return;

  const nextPurchased = !item.purchased;

  await prisma.$transaction(async (tx) => {
    await tx.shoppingListItem.update({
      where: { id: item.id },
      data: { purchased: nextPurchased },
    });

    if (item.inventoryItem) {
      const delta = nextPurchased ? item.quantity : -item.quantity;
      await tx.inventoryItem.update({
        where: { id: item.inventoryItem.id },
        data: { quantity: Math.max(0, item.inventoryItem.quantity + delta) },
      });

      if (nextPurchased && item.estimatedPrice != null) {
        await tx.priceHistory.create({
          data: { inventoryItemId: item.inventoryItem.id, price: item.estimatedPrice },
        });
      }
    }
  });

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
}

export type ReceiptScanMatch = { shoppingListItemId: string; price: number };

/**
 * Applies a reviewed receipt scan (see ReceiptScanDialog) to a shopping
 * list: for every matched line, converts its price to
 * HOUSEHOLD_BASE_CURRENCY if the receipt was in a different currency, sets
 * that as the item's estimatedPrice, and marks it purchased — mirroring
 * togglePurchasedAction's inventory-quantity/PriceHistory side effects, just
 * batched across every scanned line in one transaction instead of one
 * checkbox at a time.
 *
 * Only ever receives the OCR'd text/numbers the client already extracted
 * (see receipt-parsing.ts) — the receipt photo itself never reaches the
 * server, same privacy stance as the barcode scanner
 * (src/components/shared/barcode-scanner.tsx).
 */
export async function applyReceiptScanAction(
  listId: string,
  currency: string,
  matches: ReceiptScanMatch[],
): Promise<ActionState & { itemsUpdated?: number; totalAmount?: number }> {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
    include: { items: { include: { inventoryItem: true } } },
  });
  if (!list) return { error: "This list can't be edited right now" };

  const itemsById = new Map(list.items.map((item) => [item.id, item]));
  // Belt-and-braces de-dupe: if the client ever sent the same shopping-list
  // item twice (e.g. two OCR'd lines both matched to it), only the first is
  // applied — otherwise it would be double-counted into inventory and
  // PriceHistory below.
  const seen = new Set<string>();
  const validMatches = matches.filter((m) => {
    if (seen.has(m.shoppingListItemId)) return false;
    const item = itemsById.get(m.shoppingListItemId);
    if (!item || item.purchased || !Number.isFinite(m.price) || m.price <= 0) return false;
    seen.add(m.shoppingListItemId);
    return true;
  });
  if (validMatches.length === 0) return { error: "Nothing to apply" };

  let rate = 1;
  if (currency.toUpperCase() !== HOUSEHOLD_BASE_CURRENCY) {
    const fetched = await fetchExchangeRate(currency, HOUSEHOLD_BASE_CURRENCY);
    if (fetched === null) {
      return {
        error: `Couldn't fetch a ${currency} → ${HOUSEHOLD_BASE_CURRENCY} exchange rate right now. Try again shortly.`,
      };
    }
    rate = fetched;
  }

  let totalAmount = 0;

  await prisma.$transaction(async (tx) => {
    for (const match of validMatches) {
      const item = itemsById.get(match.shoppingListItemId)!;
      const convertedPrice = Math.round(match.price * rate * 100) / 100;
      totalAmount += convertedPrice;

      await tx.shoppingListItem.update({
        where: { id: item.id },
        data: { estimatedPrice: convertedPrice, purchased: true },
      });

      if (item.inventoryItem) {
        await tx.inventoryItem.update({
          where: { id: item.inventoryItem.id },
          data: { quantity: item.inventoryItem.quantity + item.quantity },
        });
        await tx.priceHistory.create({
          data: { inventoryItemId: item.inventoryItem.id, price: convertedPrice },
        });
      }
    }
  });

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/budget");

  return { itemsUpdated: validMatches.length, totalAmount };
}

export async function deleteShoppingListItemAction(itemId: string) {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    select: { id: true, shoppingListId: true },
  });
  if (!item) return;

  await prisma.shoppingListItem.delete({ where: { id: item.id } });

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
}

export async function completeShoppingListAction(
  listId: string,
): Promise<{ expenseLoggedMessage?: string; error?: string }> {
  const { household, userId } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
    include: { items: true },
  });
  if (!list) return {};

  // Every shopping list item should map 1:1 to an inventory item before a
  // list can be completed — rather than silently inventing an inventory
  // item for anything unlinked (the old behavior), refuse to complete and
  // let the user resolve each one via the "needs mapping" row UI
  // (MapShoppingItemDialog / linkShoppingListItemAction /
  // createInventoryItemFromShoppingListItemAction above).
  const dict = await getDictionary();
  const hasUnresolvedItems = list.items.some((item) => item.inventoryItemId === null);
  if (hasUnresolvedItems) {
    return { error: dict.shoppingList.unresolvedItemsError };
  }

  await prisma.shoppingList.update({
    where: { id: list.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  // Log a "Groceries" expense for whatever purchased items actually have an
  // estimated price set — never invent/estimate a price for items that
  // don't. Reuses Task 2's find-or-create category helper rather than
  // duplicating that lookup here.
  let groceriesTotal = 0;
  for (const item of list.items) {
    if (item.purchased && item.estimatedPrice != null) {
      groceriesTotal += item.estimatedPrice;
    }
  }

  let expenseLoggedMessage: string | undefined;

  if (groceriesTotal > 0) {
    const category = await findOrCreateGroceriesCategory(household.id);
    await prisma.transaction.create({
      data: {
        householdId: household.id,
        categoryId: category.id,
        amount: groceriesTotal,
        type: "EXPENSE",
        description: format(dict.shoppingList.expenseDescription, { name: list.name }),
        date: new Date(),
        createdByUserId: userId,
      },
    });

    const locale = await getLocale();
    const amountLabel = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(groceriesTotal);
    expenseLoggedMessage = format(dict.shoppingList.expenseLogged, { amount: amountLabel });
  }

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/budget");

  return { expenseLoggedMessage };
}
