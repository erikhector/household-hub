"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { bulkEditableFields, type BulkEditableField } from "@/lib/inventory/bulk-editable-fields";

const itemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be 120 characters or fewer"),
  // Left blank on the create/edit form or the quick-add bar, an item files
  // under the locale's "Uncategorized" label (resolved below) instead of
  // blocking the add on picking a category up front.
  category: z.string().trim().max(60, "Category must be 60 characters or fewer").optional(),
  quantity: z.coerce.number().min(0, "Quantity can't be negative"),
  unit: z.string().trim().min(1).max(20, "Unit must be 20 characters or fewer").default("pcs"),
  lowStockThreshold: z.coerce.number().min(0, "Threshold can't be negative"),
  location: z.string().trim().max(120, "Location must be 120 characters or fewer").optional(),
});

const starterKitSchema = z.object({
  category: z.string().trim().min(1).max(60),
  names: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
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

  const category = parsed.data.category || (await getDictionary()).inventory.uncategorized;

  try {
    await prisma.inventoryItem.create({
      data: { householdId: household.id, ...parsed.data, category },
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

  const category = parsed.data.category || (await getDictionary()).inventory.uncategorized;

  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      // `location` is spread explicitly (not via `...parsed.data`) so clearing
      // the field to empty actually nulls it out — Prisma drops `undefined`
      // keys from an update instead of writing them, which would otherwise
      // leave a stale location in place.
      data: { ...parsed.data, category, location: parsed.data.location ?? null },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}

// Rapid-entry path for the empty-state quick-add bar: takes just a name (no
// dialog, no category prompt) so a household starting from zero items can
// fire off several adds in a row by typing and pressing Enter. Everything
// else defaults the same way a blank create-form submission would.
export async function quickAddInventoryItemAction(name: string): Promise<{ error?: string; name?: string }> {
  const { household } = await requireHousehold();

  const parsed = itemSchema.safeParse({
    name,
    quantity: 1,
    unit: "pcs",
    lowStockThreshold: 1,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const dict = await getDictionary();

  try {
    await prisma.inventoryItem.create({
      data: { householdId: household.id, ...parsed.data, category: dict.inventory.uncategorized },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { name: parsed.data.name };
}

// Bulk-inserts a starter kit's selected items in one round trip. `category`
// and `names` arrive already translated by the client — it rendered them
// from the same locale dictionary this server action would otherwise have
// to re-resolve — so this only re-validates shape/length, not locale.
// Case-insensitively skips names the household already has so re-adding a
// kit (or overlapping two kits) doesn't create duplicate rows.
export async function addStarterKitItemsAction(
  category: string,
  names: string[],
): Promise<{ error?: string; added?: number }> {
  const { household } = await requireHousehold();

  const parsed = starterKitSchema.safeParse({ category, names });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let added = 0;
  try {
    const existing = await prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((item) => item.name.trim().toLowerCase()));
    const toAdd = [...new Set(parsed.data.names)].filter((name) => !existingNames.has(name.toLowerCase()));

    if (toAdd.length > 0) {
      await prisma.inventoryItem.createMany({
        data: toAdd.map((name) => ({
          householdId: household.id,
          name,
          category: parsed.data.category,
          quantity: 1,
          unit: "pcs",
          lowStockThreshold: 1,
        })),
      });
    }
    added = toAdd.length;
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { added };
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

const bulkFieldSchemas = {
  category: itemSchema.shape.category,
  location: itemSchema.shape.location,
  unit: itemSchema.shape.unit,
  quantity: itemSchema.shape.quantity,
  lowStockThreshold: itemSchema.shape.lowStockThreshold,
} satisfies Record<BulkEditableField, z.ZodTypeAny>;

// Sets one field to one value across many items at once — e.g. selecting
// every unassigned item and filing them all under "Fridge", or re-filing a
// batch of items under a different category, in one action instead of
// editing each item individually. `updateMany` is scoped to the household
// and the given ids together, so ids for another household's items (or
// already-deleted ids) are silently dropped rather than erroring.
export async function bulkUpdateFieldAction(
  itemIds: string[],
  field: BulkEditableField,
  rawValue: string,
): Promise<ActionState & { updated?: number }> {
  const { household } = await requireHousehold();

  const ids = [...new Set(itemIds)].filter(Boolean);
  if (ids.length === 0) return { error: "No items selected" };

  if (!bulkEditableFields.includes(field)) {
    return { error: "Invalid field" };
  }

  const parsed = bulkFieldSchemas[field].safeParse(rawValue);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid value" };
  }

  let data: Parameters<typeof prisma.inventoryItem.updateMany>[0]["data"];
  switch (field) {
    case "category":
      // Blank clears back to the locale's "Uncategorized" bucket, same as
      // the single-item form.
      data = { category: (parsed.data as string) || (await getDictionary()).inventory.uncategorized };
      break;
    case "location":
      // Blank explicitly un-assigns the location rather than being dropped
      // as a no-op update, matching the single-item edit form.
      data = { location: (parsed.data as string)?.trim() || null };
      break;
    case "unit":
      data = { unit: parsed.data as string };
      break;
    case "quantity":
      data = { quantity: parsed.data as number };
      break;
    case "lowStockThreshold":
      data = { lowStockThreshold: parsed.data as number };
      break;
  }

  let updated = 0;
  try {
    const result = await prisma.inventoryItem.updateMany({
      where: { id: { in: ids }, householdId: household.id },
      data,
    });
    updated = result.count;
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { updated };
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
