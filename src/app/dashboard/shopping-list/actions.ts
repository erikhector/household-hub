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
import { toFriendlyError } from "@/lib/actions/errors";

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
  name: z.string().trim().max(120, "List name must be 120 characters or fewer").optional(),
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
  let list;
  try {
    list = await prisma.shoppingList.create({
      data: {
        householdId: household.id,
        name:
          parsed.data.name ||
          `${dict.shoppingList.defaultNamePrefix} — ${new Date().toLocaleDateString()}`,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  redirect(`/dashboard/shopping-list/${list.id}`);
}

export async function archiveShoppingListAction(listId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.shoppingList.updateMany({
      where: { id: listId, householdId: household.id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
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

export async function generateFromLowStockAction(listId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return { error: "This list can't be edited right now" };

  try {
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
          unit: item.unit,
          addedAutomatically: true,
        })),
      });
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  return {};
}

const addItemSchema = z.object({
  listId: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be 120 characters or fewer"),
  quantity: z.coerce.number().min(0.01, "Quantity must be greater than 0"),
  unit: z.string().trim().max(20, "Unit must be 20 characters or fewer").optional(),
});

/**
 * Shared by addAdHocItemAction and quickAddShoppingListItemAction below —
 * both just create a shopping-list item ad hoc (auto-linking to inventory
 * when the name matches exactly, same as findExactInventoryItem everywhere
 * else), they just differ in where the input comes from and what they hand
 * back to the caller.
 *
 * `newItemDetails`, when given, lets the caller (ReceiptScanDialog's "add as
 * new item" shortcut) specify the category/unit a brand-new InventoryItem
 * should get when no exact-name match exists — OCR'd names are unreliable
 * enough that auto-mapping shouldn't silently guess those. addAdHocItemAction
 * doesn't pass this, so it keeps its old behavior of leaving inventoryItemId
 * null when there's no exact match.
 */
async function createAdHocShoppingListItem(
  householdId: string,
  listId: string,
  name: string,
  quantity: number,
  unit: string,
  newItemDetails?: { category: string; unit: string },
) {
  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId, status: "ACTIVE" },
  });
  if (!list) return { error: "This list can't be edited right now" } as const;

  let inventoryItem = await findExactInventoryItem(householdId, name);
  if (!inventoryItem && newItemDetails) {
    inventoryItem = await prisma.inventoryItem.create({
      data: {
        householdId,
        name,
        category: newItemDetails.category || "Uncategorized",
        unit: newItemDetails.unit || "pcs",
        quantity: 0,
        lowStockThreshold: 0,
      },
    });
  }

  const item = await prisma.shoppingListItem.create({
    data: {
      shoppingListId: list.id,
      inventoryItemId: inventoryItem?.id ?? null,
      name,
      quantity,
      unit: unit || inventoryItem?.unit || "pcs",
    },
  });
  return { list, item } as const;
}

export async function addAdHocItemAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = addItemSchema.safeParse({
    listId: formData.get("listId"),
    name: formData.get("name"),
    quantity: formData.get("quantity") || 1,
    unit: formData.get("unit") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    const result = await createAdHocShoppingListItem(
      household.id,
      parsed.data.listId,
      parsed.data.name,
      parsed.data.quantity,
      parsed.data.unit ?? "",
    );
    if ("error" in result) return { error: result.error };
    revalidatePath(`/dashboard/shopping-list/${result.list.id}`);
  } catch (error) {
    return toFriendlyError(error);
  }

  return {};
}

const quickAddSchema = addItemSchema.extend({
  category: z.string().trim().max(60, "Category must be 60 characters or fewer").optional(),
  unit: z.string().trim().max(20, "Unit must be 20 characters or fewer").optional(),
});

/**
 * Adds a new shopping-list item on the fly and hands back its id/name —
 * used by ReceiptScanDialog when a scanned line doesn't match anything
 * already on the list, so the user can create a match target for it without
 * leaving the scan review flow. `newItemDetails` is only used when that
 * creates a brand-new InventoryItem (see createAdHocShoppingListItem above).
 */
export async function quickAddShoppingListItemAction(
  listId: string,
  name: string,
  quantity: number,
  newItemDetails?: { category: string; unit: string },
): Promise<ActionState & { item?: { id: string; name: string } }> {
  const { household } = await requireHousehold();

  const parsed = quickAddSchema.safeParse({
    listId,
    name,
    quantity: quantity || 1,
    category: newItemDetails?.category,
    unit: newItemDetails?.unit,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    const result = await createAdHocShoppingListItem(
      household.id,
      parsed.data.listId,
      parsed.data.name,
      parsed.data.quantity,
      parsed.data.unit ?? "",
      newItemDetails ? { category: parsed.data.category ?? "", unit: parsed.data.unit ?? "" } : undefined,
    );
    if ("error" in result) return { error: result.error };
    revalidatePath(`/dashboard/shopping-list/${result.list.id}`);
    return { item: { id: result.item.id, name: result.item.name } };
  } catch (error) {
    return toFriendlyError(error);
  }
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

  const trimmedCategory = category.trim();
  if (trimmedCategory.length > 60) {
    return { error: "Category must be 60 characters or fewer" };
  }

  try {
    const inventoryItem = await prisma.inventoryItem.create({
      data: {
        householdId: household.id,
        name: item.name,
        category: trimmedCategory || "Uncategorized",
        quantity: 0,
        lowStockThreshold: 0,
      },
    });

    await prisma.shoppingListItem.update({
      where: { id: item.id },
      data: { inventoryItemId: inventoryItem.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/inventory");
  return {};
}

export async function togglePurchasedAction(itemId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    include: { inventoryItem: true },
  });
  if (!item) return { error: "Item not found" };

  const nextPurchased = !item.purchased;

  try {
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
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
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

export async function deleteShoppingListItemAction(itemId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    select: { id: true, shoppingListId: true },
  });
  if (!item) return { error: "Item not found" };

  try {
    await prisma.shoppingListItem.delete({ where: { id: item.id } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  return {};
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
