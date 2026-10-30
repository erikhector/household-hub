"use server";

// MAINT-3: the household's learned store-section order (AUTO-9), split out
// of the old actions.ts. The learning step itself runs when a list is
// completed (list-actions.ts).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError } from "@/lib/actions/errors";
import { applySubsetReorder, effectiveOrder, parseLearnedOrder } from "@/lib/shopping/store-order";

// Category keys (see categoryKey in shopping-mode-grouping.ts) as the
// "Reorder sections" dialog lists them. Bounded so a crafted call can't
// store an unbounded array on the household row; a real list shows at most
// a few dozen sections.
const categoryOrderSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(200);

/**
 * AUTO-9's "Reorder sections": saves a hand-arranged order of the
 * categories one list shows. It's merged into the household's whole
 * current order (applySubsetReorder) rather than replacing it, so sections
 * this list doesn't have keep their place. Once saved, a manual order
 * always beats the learned one (storeOrderSortKey) until it's reset; the
 * learning itself keeps running underneath, so a reset lands on an
 * up-to-date learned order. Household-wide, like the learned order —
 * everyone shops the same store.
 */
export async function saveCategoryOrderAction(keys: string[]): Promise<ActionState> {
  const { household } = await requireHousehold();
  const parsed = categoryOrderSchema.safeParse(keys);
  if (!parsed.success) return await fail("invalidSectionOrder");

  const current = {
    learned: parseLearnedOrder(household.categoryOrderLearned),
    manual: household.categoryOrderManual,
  };
  const manual = applySubsetReorder(effectiveOrder(current, parsed.data), parsed.data);
  try {
    await prisma.household.update({ where: { id: household.id }, data: { categoryOrderManual: manual } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list/[id]", "page");
  return {};
}

/**
 * Drops the hand-arranged order so the learned one takes over again.
 * Returns the order it dropped so the toast's "Undo" can put it back via
 * saveCategoryOrderAction (Guardrails: undo over confirm).
 */
export async function resetCategoryOrderAction(): Promise<ActionState & { previous?: string[] }> {
  const { household } = await requireHousehold();
  const previous = household.categoryOrderManual;
  try {
    await prisma.household.update({ where: { id: household.id }, data: { categoryOrderManual: [] } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list/[id]", "page");
  return { previous };
}
