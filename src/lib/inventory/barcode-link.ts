import type { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/lib/prisma";

type DbClient = typeof prisma | Prisma.TransactionClient;

// Frees `barcode` from whichever of this household's items currently holds
// it (other than `keepItemId`), so the caller can set it on another row
// without tripping InventoryItem's @@unique([householdId, barcode]). This
// is AUTO-6's "linking a code already on another item moves it" rule: one
// product per code per household, and the most recent explicit link wins —
// a household that got the link wrong fixes it by linking again, never by
// hunting down the old row. Call it inside the same $transaction as the
// write that sets the code, so there's no window with the code on neither
// (or both) rows.
//
// Trusts `householdId` — callers resolve it from their own
// requireHousehold() first, like recordOutOfStockTransition.
export async function releaseBarcode(
  db: DbClient,
  householdId: string,
  barcode: string,
  keepItemId?: string,
): Promise<void> {
  await db.inventoryItem.updateMany({
    where: { householdId, barcode, ...(keepItemId ? { id: { not: keepItemId } } : {}) },
    data: { barcode: null },
  });
}
