"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { bulkEditableFields, type BulkEditableField } from "@/lib/inventory/bulk-editable-fields";
import { recordOutOfStockTransition } from "@/lib/notifications";

const itemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be 120 characters or fewer"),
  // Left blank on the create/edit form or the quick-add bar, an item files
  // under the locale's "Uncategorized" label (resolved below) instead of
  // blocking the add on picking a category up front.
  category: z.string().trim().max(60, "Category must be 60 characters or fewer").optional(),
  // Rounded to at most 2 decimal places at the boundary — the display and
  // meal-cooking decrement (cooking-actions.ts) assume the same precision,
  // and rounding here keeps stray float drift (e.g. entering 0.1 + 0.2) out
  // of storage rather than just hiding it later.
  quantity: z.coerce
    .number()
    .min(0, "Quantity can't be negative")
    .transform((n) => Math.round(n * 100) / 100),
  unit: z.string().trim().min(1).max(20, "Unit must be 20 characters or fewer").default("pcs"),
  lowStockThreshold: z.coerce.number().min(0, "Threshold can't be negative"),
  location: z.string().trim().max(120, "Location must be 120 characters or fewer").optional(),
  // Native <input type="date"> value ("" when left blank) — only ever set
  // from the single-item add/edit form, never any bulk-add flow.
  expiresAt: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : null)),
});

const starterKitSchema = z.object({
  category: z.string().trim().min(1).max(60),
  names: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
});

export async function createInventoryItemAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit") || "pcs",
    lowStockThreshold: formData.get("lowStockThreshold"),
    location: formData.get("location") || undefined,
    expiresAt: formData.get("expiresAt") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const category = parsed.data.category || (await getDictionary()).inventory.uncategorized;

  try {
    await prisma.inventoryItem.create({
      data: { householdId: household.id, ...parsed.data, category, updatedByUserId: userId },
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
  const { household, userId } = await requireHousehold();

  const itemId = String(formData.get("itemId") ?? "");
  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit") || "pcs",
    lowStockThreshold: formData.get("lowStockThreshold"),
    location: formData.get("location") || undefined,
    expiresAt: formData.get("expiresAt") || undefined,
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
      data: { ...parsed.data, category, location: parsed.data.location ?? null, updatedByUserId: userId },
    });
    await recordOutOfStockTransition(prisma, household.id, item.id, item.quantity, parsed.data.quantity, userId);
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}

// Rapid-entry path for the quick-add bar/grid: no dialog round trip, so a
// household starting from zero items (or blitzing through a shelf) can fire
// off several adds in a row by typing and pressing Enter. `quantity`/`unit`/
// `category` are optional — left out entirely, this defaults exactly the
// way a blank create-form submission would (qty 1, "pcs", "Uncategorized").
export async function quickAddInventoryItemAction(input: {
  name: string;
  quantity?: number;
  unit?: string;
  category?: string;
}): Promise<{ error?: string; name?: string }> {
  const { household, userId } = await requireHousehold();

  const parsed = itemSchema.safeParse({
    name: input.name,
    category: input.category,
    quantity: input.quantity ?? 1,
    unit: input.unit || "pcs",
    lowStockThreshold: 1,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const category = parsed.data.category || (await getDictionary()).inventory.uncategorized;

  try {
    await prisma.inventoryItem.create({
      data: { householdId: household.id, ...parsed.data, category, updatedByUserId: userId },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { name: parsed.data.name };
}

const bulkCreateItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.coerce
    .number()
    .min(0)
    .default(1)
    .transform((n) => Math.round(n * 100) / 100),
  unit: z.string().trim().min(1).max(20).default("pcs"),
});

const bulkCreateSchema = z.object({
  items: z.array(bulkCreateItemSchema).min(1).max(300),
  category: z.string().trim().max(60).optional(),
  location: z.string().trim().max(120).optional(),
});

// Shared batch-insert path for the scan queue and the pasted-list review
// screen — both land here with a flat list of {name, quantity, unit} plus
// one category/location applied to the whole batch (a scanning or unpacking
// session is almost always one shelf/drawer at a time). Mirrors
// addStarterKitItemsAction's case-insensitive dedupe against what the
// household already has, so re-running a scan session over the same shelf
// doesn't create duplicate rows — it just skips the repeats.
export async function bulkCreateInventoryItemsAction(
  items: { name: string; quantity?: number; unit?: string }[],
  shared?: { category?: string; location?: string },
): Promise<{ error?: string; added?: number; skipped?: number }> {
  const { household, userId } = await requireHousehold();

  const parsed = bulkCreateSchema.safeParse({ items, category: shared?.category, location: shared?.location });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const dict = await getDictionary();
  const category = parsed.data.category || dict.inventory.uncategorized;
  const location = parsed.data.location || null;

  let added = 0;
  let skipped = 0;
  try {
    const existing = await prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((item) => item.name.trim().toLowerCase()));

    // Later duplicates within the same batch (two rows scanned/pasted for
    // the same item) merge into one row by summing quantity, rather than
    // creating two rows or silently dropping the second.
    const merged = new Map<string, { name: string; quantity: number; unit: string }>();
    for (const item of parsed.data.items) {
      const key = item.name.toLowerCase();
      if (existingNames.has(key)) {
        skipped += 1;
        continue;
      }
      const prev = merged.get(key);
      merged.set(
        key,
        prev ? { ...prev, quantity: Math.round((prev.quantity + item.quantity) * 100) / 100 } : item,
      );
    }

    const toAdd = [...merged.values()];
    if (toAdd.length > 0) {
      await prisma.inventoryItem.createMany({
        data: toAdd.map((item) => ({
          householdId: household.id,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          category,
          location,
          lowStockThreshold: 1,
          updatedByUserId: userId,
        })),
      });
    }
    added = toAdd.length;
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { added, skipped };
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
  const { household, userId } = await requireHousehold();

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
          updatedByUserId: userId,
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
  const { household, userId } = await requireHousehold();

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return { error: "Item not found" };

  const nextQuantity = Math.round(Math.max(0, item.quantity + delta) * 100) / 100;
  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: nextQuantity, updatedByUserId: userId },
    });
    await recordOutOfStockTransition(prisma, household.id, item.id, item.quantity, nextQuantity, userId);
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
  const { household, userId } = await requireHousehold();

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return { error: "Item not found" };

  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: 0, updatedByUserId: userId },
    });
    await recordOutOfStockTransition(prisma, household.id, item.id, item.quantity, 0, userId);
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
  const { household, userId } = await requireHousehold();

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
    // Only needed to detect an out-of-stock transition below — skipped for
    // every other field.
    const previousQuantities =
      field === "quantity"
        ? await prisma.inventoryItem.findMany({
            where: { id: { in: ids }, householdId: household.id },
            select: { id: true, quantity: true, lowStockThreshold: true },
          })
        : [];

    const result = await prisma.inventoryItem.updateMany({
      where: { id: { in: ids }, householdId: household.id },
      data: { ...data, updatedByUserId: userId },
    });
    updated = result.count;

    if (field === "quantity") {
      const nextQuantity = parsed.data as number;
      await Promise.all(
        previousQuantities.map((item) =>
          recordOutOfStockTransition(prisma, household.id, item.id, item.quantity, nextQuantity, userId),
        ),
      );
    }
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
