// What "Add low-stock items" puts on a list: every inventory item that is out
// or low once stock bought but not yet put away is counted
// (coveredQuantity, src/lib/incoming-stock.ts), minus the items the target
// list already has a pending row for. One rule for both the action that adds
// them (generateFromLowStockAction, list-actions.ts) and Home's "Add N"
// button (UX-HOME-2), so the number on the button is what the tap adds.

import { getStockStatus } from "@/lib/stock-status";
import { coveredQuantity } from "@/lib/incoming-stock";

export function lowStockToAdd<T extends { id: string; quantity: number; lowStockThreshold: number }>(
  items: readonly T[],
  incomingByItem: ReadonlyMap<string, number>,
  pendingOnTargetIds: ReadonlySet<string | null>,
): T[] {
  return items.filter(
    (item) =>
      getStockStatus(coveredQuantity(item.quantity, incomingByItem.get(item.id) ?? 0), item.lowStockThreshold) !==
        "in" && !pendingOnTargetIds.has(item.id),
  );
}
