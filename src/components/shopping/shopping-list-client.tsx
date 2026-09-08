"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ExportButton } from "@/components/export/export-button";
import { BarcodeScannerButton, ScannedBarcodeNote, type BarcodeScanResult } from "@/components/shared/barcode-scanner";
import { MapShoppingItemDialog } from "@/components/shopping/map-shopping-item-dialog";
import { ReceiptScanDialog } from "@/components/shopping/receipt-scan-dialog";
import {
  addAdHocItemAction,
  archiveShoppingListAction,
  completeShoppingListAction,
  deleteShoppingListAction,
  deleteShoppingListItemAction,
  generateFromLowStockAction,
  togglePurchasedAction,
  unarchiveShoppingListAction,
} from "@/app/dashboard/shopping-list/actions";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type ShoppingListItemRow = {
  id: string;
  name: string;
  quantity: number;
  purchased: boolean;
  addedAutomatically: boolean;
  inventoryItemId: string | null;
};

type InventoryItemOption = { id: string; name: string; category: string };

type ShoppingListData = {
  id: string;
  name: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  items: ShoppingListItemRow[];
};

type ShoppingListDict = Dictionary["shoppingList"];

const initialState: ActionState = {};

function AddItemForm({
  listId,
  dict,
  barcodeDict,
}: {
  listId: string;
  dict: ShoppingListDict;
  barcodeDict: Dictionary["barcodeScanner"];
}) {
  const [name, setName] = useState("");
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await addAdHocItemAction(prevState, formData);
    if (!result.error) {
      setName("");
      setScannedBarcode(null);
    }
    return result;
  }, initialState);

  const handleScanResult = ({ barcode, name: scannedName }: BarcodeScanResult) => {
    setScannedBarcode(barcode);
    if (scannedName) setName(scannedName);
  };

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="listId" value={listId} />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Input
            name="name"
            placeholder={dict.addItemNamePlaceholder}
            required
            maxLength={120}
            className="w-48"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Input
          name="quantity"
          type="number"
          min={0.01}
          step="any"
          defaultValue={1}
          className="w-20"
        />
        <BarcodeScannerButton dict={barcodeDict} onResult={handleScanResult} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? dict.adding : dict.add}
        </Button>
      </div>
      {scannedBarcode && (
        <div className="flex flex-col gap-0.5">
          <ScannedBarcodeNote barcode={scannedBarcode} dict={barcodeDict} />
          {!name && <p className="text-xs text-muted-foreground">{barcodeDict.notFound}</p>}
        </div>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

export function ShoppingListClient({
  list,
  inventoryItems,
  categories,
  dict,
  barcodeDict,
  exportLabel,
}: {
  list: ShoppingListData;
  inventoryItems: InventoryItemOption[];
  categories: string[];
  dict: ShoppingListDict;
  barcodeDict: Dictionary["barcodeScanner"];
  exportLabel: string;
}) {
  const [isPending, startTransition] = useTransition();

  const pendingItems = list.items.filter((item) => !item.purchased);
  const purchasedItems = list.items.filter((item) => item.purchased);
  const isActive = list.status === "ACTIVE";
  const statusLabel = list.status === "COMPLETED" ? dict.statusCompleted : dict.statusArchived;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard/shopping-list"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {dict.backToAll}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{list.name}</h1>
            {!isActive && <Badge variant="secondary">{statusLabel}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton href={`/dashboard/shopping-list/${list.id}/export`} label={exportLabel} />
          {isActive && (
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await generateFromLowStockAction(list.id);
                  if (result.error) toast.error(result.error);
                })
              }
            >
              {dict.addLowStock}
            </Button>
          )}
          {isActive && pendingItems.length > 0 && (
            <ReceiptScanDialog
              listId={list.id}
              pendingItems={pendingItems.map((item) => ({ id: item.id, name: item.name }))}
              categories={categories}
              dict={dict.receiptScan}
            />
          )}
          {isActive && list.items.length > 0 && (
            <Button
              variant="secondary"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await completeShoppingListAction(list.id);
                  if (result.error) toast.error(result.error);
                  if (result.expenseLoggedMessage) toast.success(result.expenseLoggedMessage);
                })
              }
            >
              {dict.completeList}
            </Button>
          )}
          {list.status === "ARCHIVED" ? (
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await unarchiveShoppingListAction(list.id);
                  if (result.error) toast.error(result.error);
                })
              }
            >
              <ArchiveRestore className="size-4" />
              {dict.unarchive}
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await archiveShoppingListAction(list.id);
                  if (result.error) toast.error(result.error);
                })
              }
            >
              <Archive className="size-4" />
              {dict.archive}
            </Button>
          )}
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteShoppingListAction(list.id);
                if (result.error) toast.error(result.error);
              })
            }
          >
            <Trash2 className="size-4" />
            {dict.delete}
          </Button>
        </div>
      </div>

      {isActive && <AddItemForm listId={list.id} dict={dict} barcodeDict={barcodeDict} />}

      <div className="flex flex-col gap-2">
        {pendingItems.length === 0 && purchasedItems.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {isActive ? dict.emptyListActive : dict.emptyListOther}
          </p>
        ) : (
          <>
            {pendingItems.map((item) => (
              <ShoppingRow
                key={item.id}
                item={item}
                editable={isActive}
                isPending={isPending}
                startTransition={startTransition}
                inventoryItems={inventoryItems}
                dict={dict}
              />
            ))}
            {purchasedItems.length > 0 && (
              <p className="mt-4 text-xs font-medium uppercase text-muted-foreground">
                {dict.purchased}
              </p>
            )}
            {purchasedItems.map((item) => (
              <ShoppingRow
                key={item.id}
                item={item}
                editable={isActive}
                isPending={isPending}
                startTransition={startTransition}
                inventoryItems={inventoryItems}
                dict={dict}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ShoppingRow({
  item,
  editable,
  isPending,
  startTransition,
  inventoryItems,
  dict,
}: {
  item: ShoppingListItemRow;
  editable: boolean;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
  inventoryItems: InventoryItemOption[];
  dict: ShoppingListDict;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-3">
          <input
            type="checkbox"
            checked={item.purchased}
            disabled={isPending || !editable}
            onChange={() =>
              startTransition(async () => {
                const result = await togglePurchasedAction(item.id);
                if (result.error) toast.error(result.error);
              })
            }
            className="size-4 shrink-0"
          />
          <span
            className={`min-w-0 flex-1 truncate ${item.purchased ? "text-muted-foreground line-through" : ""}`}
            title={`${item.name} × ${item.quantity}`}
          >
            {item.name} × {item.quantity}
          </span>
          {item.addedAutomatically && (
            <Badge variant="secondary" className="shrink-0">
              {dict.lowStockBadge}
            </Badge>
          )}
        </label>
        {item.inventoryItemId === null &&
          (editable ? (
            <MapShoppingItemDialog
              item={item}
              inventoryItems={inventoryItems}
              dict={dict.mapItem}
              trigger={
                <Badge
                  variant="outline"
                  className="shrink-0 cursor-pointer border-dashed text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
                >
                  {dict.matchItemButton}
                </Badge>
              }
            />
          ) : (
            <Badge variant="outline" className="shrink-0 border-dashed">
              {dict.needsMappingBadge}
            </Badge>
          ))}
      </div>
      {editable && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteShoppingListItemAction(item.id);
              if (result.error) toast.error(result.error);
            })
          }
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
