"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";

const itemSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  category: z.string().trim().min(1, "Category is required"),
  quantity: z.coerce.number().min(0, "Quantity can't be negative"),
  unit: z.string().trim().min(1).default("pcs"),
  lowStockThreshold: z.coerce.number().min(0, "Threshold can't be negative"),
  location: z.string().trim().optional(),
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

  await prisma.inventoryItem.create({
    data: { householdId: household.id, ...parsed.data },
  });

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}

export async function adjustQuantityAction(itemId: string, delta: number) {
  const { household } = await requireHousehold();

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return;

  const nextQuantity = Math.max(0, item.quantity + delta);
  await prisma.inventoryItem.update({
    where: { id: item.id },
    data: { quantity: nextQuantity },
  });

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
}

export async function deleteInventoryItemAction(itemId: string) {
  const { household } = await requireHousehold();

  await prisma.inventoryItem.deleteMany({
    where: { id: itemId, householdId: household.id },
  });

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
}
