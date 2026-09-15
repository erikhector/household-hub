"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, Archive, ArchiveRestore, CheckCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExportButton } from "@/components/export/export-button";
import { ShoppingItemFormDialog } from "@/components/shopping/shopping-item-form-dialog";
import { ReceiptScanDialog } from "@/components/shopping/receipt-scan-dialog";
import { ResolveMappingsDialog } from "@/components/shopping/resolve-mappings-dialog";
import { ShareListButton } from "@/components/shopping/share-list-button";
import {
  archiveShoppingListAction,
  completeShoppingListAction,
  deleteShoppingListAction,
  deleteShoppingListItemAction,
  generateFromLowStockAction,
  togglePurchasedAction,
  unarchiveShoppingListAction,
} from "@/app/dashboard/shopping-list/actions";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// Below this many unlinked items, resolving them one at a time via each
// row's edit dialog is fine; above it, the batch ResolveMappingsDialog is
// offered instead so the user isn't clicking into the same dialog N times.
const BATCH_RESOLVE_THRESHOLD = 3;

type ShoppingListItemRow = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  purchased: boolean;
  addedAutomatically: boolean;
  inventoryItemId: string | null;
};

type InventoryItemOption = { id: string; name: string; category: string; unit?: string };

type ShoppingListData = {
  id: string;
  name: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  items: ShoppingListItemRow[];
};

type ShoppingListDict = Dictionary["shoppingList"];

export function ShoppingListClient({
  list,
  inventoryItems,
  categories,
  units,
  dict,
  barcodeDict,
  exportLabel,
}: {
  list: ShoppingListData;
  inventoryItems: InventoryItemOption[];
  categories: string[];
  units: string[];
  dict: ShoppingListDict;
  barcodeDict: Dictionary["barcodeScanner"];
  exportLabel: string;
}) {
  const [isPending, startTransition] = useTransition();

  const pendingItems = list.items.filter((item) => !item.purchased);
  const purchasedItems = list.items.filter((item) => item.purchased);
  const isActive = list.status === "ACTIVE";
  const statusLabel = list.status === "COMPLETED" ? dict.statusCompleted : dict.statusArchived;
  const unresolvedItems = list.items.filter((item) => item.inventoryItemId === null);

  // "Cleared" covers two cases: every item got checked off (purchasedItems
  // non-empty), or the list was emptied out entirely after having had items
  // this session (hadItems distinguishes that from a list that's simply
  // never had anything added to it, which gets the plain empty state).
  const [hadItems, setHadItems] = useState(list.items.length > 0);
  if (list.items.length > 0 && !hadItems) setHadItems(true);
  const isCleared =
    pendingItems.length === 0 && (purchasedItems.length > 0 || (list.items.length === 0 && hadItems));

  // Adjust-state-during-render pattern: re-arm the dismissal the moment the
  // list leaves the cleared state (e.g. a new item is added), so the next
  // time it clears it shows fresh instead of staying dismissed forever.
  const [wasCleared, setWasCleared] = useState(isCleared);
  const [clearedDismissed, setClearedDismissed] = useState(false);
  if (isCleared !== wasCleared) {
    setWasCleared(isCleared);
    if (!isCleared) setClearedDismissed(false);
  }
  const showCleared = isCleared && !clearedDismissed;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard/shopping-list"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {dict.backToAll}
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{list.name}</h1>
            {!isActive && <Badge variant="secondary">{statusLabel}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isActive && (
            <ShoppingItemFormDialog
              mode="create"
              listId={list.id}
              inventoryItems={inventoryItems}
              units={units}
              dict={dict}
              barcodeDict={barcodeDict}
            />
          )}
          <ExportButton href={`/dashboard/shopping-list/${list.id}/export`} label={exportLabel} />
          {isActive && <ShareListButton shoppingListId={list.id} dict={dict.shareLink} />}
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
              inventoryItems={inventoryItems}
              categories={categories}
              units={units}
              dict={dict.receiptScan}
            />
          )}
          {isActive && unresolvedItems.length >= BATCH_RESOLVE_THRESHOLD && (
            <ResolveMappingsDialog
              items={unresolvedItems.map((item) => ({ id: item.id, name: item.name }))}
              inventoryItems={inventoryItems}
              categories={categories}
              dict={dict.resolveMappings}
              triggerLabel={format(plural(unresolvedItems.length, dict.resolveMappings.triggerButton), {
                count: unresolvedItems.length,
              })}
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
                  if (result.unresolvedNotice) toast.info(result.unresolvedNotice);
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
          <ConfirmDialog
            trigger={
              <Button variant="destructive" disabled={isPending}>
                <Trash2 className="size-4" />
                {dict.delete}
              </Button>
            }
            title={format(dict.confirmDeleteList.title, { name: list.name })}
            description={dict.confirmDeleteList.description}
            cancelLabel={dict.confirmDeleteList.cancel}
            confirmLabel={dict.confirmDeleteList.confirm}
            pendingLabel={dict.confirmDeleteList.confirming}
            onConfirm={() =>
              startTransition(async () => {
                const result = await deleteShoppingListAction(list.id);
                if (result.error) toast.error(result.error);
              })
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {showCleared ? (
          <ClearedState dict={dict} onDismiss={() => setClearedDismissed(true)} />
        ) : pendingItems.length === 0 && purchasedItems.length === 0 ? (
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
                categories={categories}
                units={units}
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
                categories={categories}
                units={units}
                dict={dict}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ClearedState({ dict, onDismiss }: { dict: ShoppingListDict; onDismiss: () => void }) {
  return (
    <div className="relative flex flex-col items-center gap-1.5 rounded-md border border-dashed p-8 text-center">
      <CheckCheck className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium">{dict.clearedTitle}</p>
      <p className="text-sm text-muted-foreground">{dict.clearedDescription}</p>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 size-7 text-muted-foreground"
        aria-label={dict.clearedDismissAriaLabel}
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function ShoppingRow({
  item,
  editable,
  isPending,
  startTransition,
  inventoryItems,
  categories,
  units,
  dict,
}: {
  item: ShoppingListItemRow;
  editable: boolean;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
  inventoryItems: InventoryItemOption[];
  categories: string[];
  units: string[];
  dict: ShoppingListDict;
}) {
  const needsMapping = item.inventoryItemId === null;

  return (
    <div className="flex flex-col gap-1 rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-3">
          <Checkbox
            checked={item.purchased}
            disabled={isPending || !editable}
            onChange={() =>
              startTransition(async () => {
                const result = await togglePurchasedAction(item.id);
                if (result.error) toast.error(result.error);
              })
            }
          />
          <span
            className={`min-w-0 flex-1 truncate ${item.purchased ? "text-muted-foreground line-through" : ""}`}
            title={`${item.name} × ${item.quantity} ${item.unit}`}
          >
            {item.name} × {item.quantity} {item.unit}
          </span>
          {item.addedAutomatically && (
            <Badge variant="secondary" className="shrink-0">
              {dict.lowStockBadge}
            </Badge>
          )}
          {!editable && needsMapping && (
            <Badge variant="outline" className="shrink-0 border-dashed">
              {dict.needsMappingBadge}
            </Badge>
          )}
        </label>
        {editable && (
          <div className="flex shrink-0 items-center gap-1">
            <ShoppingItemFormDialog
              mode="edit"
              item={item}
              inventoryItems={inventoryItems}
              categories={categories}
              units={units}
              dict={dict}
              editAriaLabel={format(dict.editItemAriaLabel, { name: item.name })}
              matchItemLabel={dict.matchItemButton}
            />
            <ConfirmDialog
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  disabled={isPending}
                  aria-label={format(dict.deleteItemAriaLabel, { name: item.name })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              }
              title={format(dict.confirmDeleteItem.title, { name: item.name })}
              description={dict.confirmDeleteItem.description}
              cancelLabel={dict.confirmDeleteItem.cancel}
              confirmLabel={dict.confirmDeleteItem.confirm}
              pendingLabel={dict.confirmDeleteItem.confirming}
              onConfirm={() =>
                startTransition(async () => {
                  const result = await deleteShoppingListItemAction(item.id);
                  if (result.error) toast.error(result.error);
                })
              }
            />
          </div>
        )}
      </div>
      {/* Persistent, always-visible explanation for as long as the item
          stays unlinked — the "Match item" badge above (in
          ShoppingItemFormDialog) is easy to miss on its own, so this spells
          out the consequence (buying it won't update pantry stock) right
          under the item the moment it's added, rather than only at
          list-completion time (see unresolvedNotice). */}
      {editable && needsMapping && (
        <p className="pl-7 text-xs text-muted-foreground">{dict.needsMappingHint}</p>
      )}
    </div>
  );
}
