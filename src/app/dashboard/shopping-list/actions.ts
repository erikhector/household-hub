"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { ActionState } from "@/lib/actions/auth";

async function findOrCreateInventoryItem(householdId: string, name: string) {
  const existing = await prisma.inventoryItem.findFirst({
    where: { householdId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing;

  return prisma.inventoryItem.create({
    data: { householdId, name, category: "Uncategorized", quantity: 0, lowStockThreshold: 0 },
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

  const inventoryItem = await findOrCreateInventoryItem(household.id, parsed.data.name);
  await prisma.shoppingListItem.create({
    data: {
      shoppingListId: list.id,
      inventoryItemId: inventoryItem.id,
      name: parsed.data.name,
      quantity: parsed.data.quantity,
    },
  });

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
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

export async function completeShoppingListAction(listId: string) {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
    include: { items: { where: { inventoryItemId: null } } },
  });
  if (!list) return;

  // Every shopping list item should map 1:1 to an inventory item — link (or
  // create) inventory items for anything that slipped through unlinked.
  for (const item of list.items) {
    const inventoryItem = await findOrCreateInventoryItem(household.id, item.name);
    await prisma.shoppingListItem.update({
      where: { id: item.id },
      data: { inventoryItemId: inventoryItem.id },
    });
  }

  await prisma.shoppingList.update({
    where: { id: list.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath("/dashboard/inventory");
}
