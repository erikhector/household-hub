"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { deleteInventoryItemAction } from "@/app/dashboard/inventory/actions";
import { ItemActions } from "@/components/inventory/item-actions";
import { ExpiryBadge } from "@/components/inventory/expiry-badge";
import { StockBadge } from "@/components/inventory/stock-badge";
import { QuantityStepper } from "@/components/inventory/inventory-table";
import { useItemHandlers } from "@/components/inventory/use-item-handlers";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { startUndoableDelete } from "@/components/shared/start-undoable-delete";
import { format } from "@/lib/i18n/format";
import type { HouseholdMemberOption, InventoryItemRow } from "@/components/inventory/inventory-table-utils";
import { getStockStatus } from "@/lib/stock-status";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

// UX-124: the controls the inventory list gives a row, on the item's own
// page: the −/+ stepper, the stock, expiry, opened and frozen badges, and the
// same Edit / Delete / Mark opened / Freeze / Mark empty / Add to list
// cluster (ItemActions), all reusing the list's components so the two never
// drift apart. The saves revalidate this page (see the actions), so the
// badges follow a change. `children` is whatever the page wants beside the
// stepper (the low-stock threshold and "Change unit…").
export function ItemPageControls({
  item,
  categories,
  locations,
  units,
  members,
  locale,
  dict,
  barcodeDict,
  autoAddEnabled,
  backHref,
  bestBeforeLabel,
  children,
}: {
  item: InventoryItemRow;
  categories: string[];
  locations: string[];
  units: string[];
  members: HouseholdMemberOption[];
  locale: Locale;
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  autoAddEnabled: boolean;
  /** Where Delete lands: the page is gone, so back to where it was opened from. */
  backHref: string;
  /** "Best before 3 Nov 2026", already formatted by the page; null for an
   * item with no date. */
  bestBeforeLabel: string | null;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { addToShoppingList, handleMarkEmpty, handleMarkOpened, handleFreeze } = useItemHandlers({
    dict,
    locale,
    run: (action) => startTransition(action),
  });

  // UX-49: Delete leaves the page at once, for where it came from, and the
  // toast there offers Undo; the delete only goes out when it closes. Undo
  // just keeps the item, so there is nothing to put back on this page.
  function handleDelete(row: InventoryItemRow) {
    router.push(backHref);
    startUndoableDelete({
      run: async () =>
        (await settleOptimisticAction(() => deleteInventoryItemAction(row.id), dict.saveFailedToast)) !== null,
      restore: () => {},
      message: format(dict.swipe.deletedToast, { name: row.name }),
      undoLabel: dict.swipe.undo,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <QuantityStepper item={item} layout="card" disabled={isPending} dict={dict} />
        <div className="flex flex-wrap items-center gap-1">
          <StockBadge status={getStockStatus(item.quantity, item.lowStockThreshold)} dict={dict} />
          <ExpiryBadge
            expiresAt={item.expiresAt}
            expiresAtEstimated={item.expiresAtEstimated}
            openedAt={item.openedAt}
            frozenAt={item.frozenAt}
            dict={dict}
          />
        </div>
        <div className="ml-auto">
          <ItemActions
            item={item}
            categories={categories}
            locations={locations}
            units={units}
            members={members}
            locale={locale}
            dict={dict}
            barcodeDict={barcodeDict}
            isPending={isPending}
            autoAddEnabled={autoAddEnabled}
            onAddToList={(row) => addToShoppingList([row.id])}
            onMarkEmpty={handleMarkEmpty}
            onMarkOpened={handleMarkOpened}
            onFreeze={handleFreeze}
            onDelete={handleDelete}
            size="size-9"
            hideDetails
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{children}</div>
      {bestBeforeLabel && <p className="text-sm text-muted-foreground">{bestBeforeLabel}</p>}
    </div>
  );
}
