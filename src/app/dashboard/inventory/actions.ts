"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";

const itemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be 120 characters or fewer"),
  category: z.string().trim().min(1, "Category is required").max(60, "Category must be 60 characters or fewer"),
  quantity: z.coerce.number().min(0, "Quantity can't be negative"),
  unit: z.string().trim().min(1).max(20, "Unit must be 20 characters or fewer").default("pcs"),
  lowStockThreshold: z.coerce.number().min(0, "Threshold can't be negative"),
  location: z.string().trim().max(120, "Location must be 120 characters or fewer").optional(),
});

export async function createInventoryItemAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit") || "pcs",
    lowStockThreshold: formData.get("lowStockThreshold"),
    location: formData.get("location") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    await prisma.inventoryItem.create({
      data: { householdId: household.id, ...parsed.data },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}

export async function updateInventoryItemAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const itemId = String(formData.get("itemId") ?? "");
  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit") || "pcs",
    lowStockThreshold: formData.get("lowStockThreshold"),
    location: formData.get("location") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return { error: "Item not found" };

  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      // `location` is spread explicitly (not via `...parsed.data`) so clearing
      // the field to empty actually nulls it out — Prisma drops `undefined`
      // keys from an update instead of writing them, which would otherwise
      // leave a stale location in place.
      data: { ...parsed.data, location: parsed.data.location ?? null },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}

export async function adjustQuantityAction(
  itemId: string,
  delta: number,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return { error: "Item not found" };

  const nextQuantity = Math.max(0, item.quantity + delta);
  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: nextQuantity },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}

// Zeroes an item's quantity in one click and, optionally, drops it onto a
// shopping list — the household's most recently created active list, or a
// freshly created default-named one if there isn't one yet (mirrors
// createShoppingListAction's naming). Dedupes against an already-pending
// entry for the same inventory item like generateFromLowStockAction does,
// so repeated "mark empty" clicks don't pile up duplicate rows.
export async function markItemEmptyAction(
  itemId: string,
  addToShoppingList: boolean,
): Promise<{ listName?: string; error?: string }> {
  const { household } = await requireHousehold();

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return { error: "Item not found" };

  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: 0 },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");

  if (!addToShoppingList) return {};

  try {
    let list = await prisma.shoppingList.findFirst({
      where: { householdId: household.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });

    if (!list) {
      const dict = await getDictionary();
      list = await prisma.shoppingList.create({
        data: {
          householdId: household.id,
          name: `${dict.shoppingList.defaultNamePrefix} — ${new Date().toLocaleDateString()}`,
        },
      });
    }

    const alreadyOnList = await prisma.shoppingListItem.findFirst({
      where: { shoppingListId: list.id, purchased: false, inventoryItemId: item.id },
    });
    if (!alreadyOnList) {
      await prisma.shoppingListItem.create({
        data: {
          shoppingListId: list.id,
          inventoryItemId: item.id,
          name: item.name,
          quantity: Math.max(1, item.lowStockThreshold),
        },
      });
    }

    revalidatePath(`/dashboard/shopping-list/${list.id}`);
    revalidatePath("/dashboard/shopping-list");

    return { listName: list.name };
  } catch (error) {
    return toFriendlyError(error);
  }
}

export async function deleteInventoryItemAction(itemId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.inventoryItem.deleteMany({
      where: { id: itemId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}
