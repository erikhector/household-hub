"use client";

import { Fragment, useMemo, useOptimistic, useState, useTransition } from "react";
import { Minus, Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  adjustQuantityAction,
  bulkUpdateFieldAction,
  deleteInventoryItemAction,
  markItemEmptyAction,
  markItemOpenedAction,
  undoMarkItemOpenedAction,
} from "@/app/dashboard/inventory/actions";
import { bulkEditableFields, type BulkEditableField } from "@/lib/inventory/bulk-editable-fields";
import { ItemFormDialog } from "@/components/inventory/add-item-dialog";
import { QuickAddBar } from "@/components/inventory/quick-add-bar";
import { StarterKitPicker } from "@/components/inventory/starter-kit-picker";
import { BulkScanDialog } from "@/components/inventory/bulk-scan-dialog";
import { BulkPasteDialog } from "@/components/inventory/bulk-paste-dialog";
import { StockBadge } from "@/components/inventory/stock-badge";
import { ExpiryBadge } from "@/components/inventory/expiry-badge";
import { ItemActions } from "@/components/inventory/item-actions";
import { LastUpdatedCell } from "@/components/inventory/last-updated-cell";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { getStockStatus } from "@/lib/stock-status";
import { nextQuantityAfterDelta } from "@/lib/inventory/stock-change";
import { formatQuantity } from "@/lib/format-quantity";
import {
  groupItems,
  type HouseholdMemberOption,
  type InventoryGroupBy,
  type InventoryItemRow,
} from "@/components/inventory/inventory-table-utils";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type { HouseholdMemberOption, InventoryGroupBy, InventoryItemRow };

export function InventoryTable({
  items,
  categories,
  locations,
  units,
  members,
  locale,
  groupBy = "none",
  emptyMessage,
  isHouseholdEmpty = false,
  dict,
  barcodeDict,
  aiCategoryFallbackEnabled = false,
}: {
  items: InventoryItemRow[];
  categories: string[];
  locations: string[];
  units: string[];
  members: HouseholdMemberOption[];
  locale: Locale;
  groupBy?: InventoryGroupBy;
  emptyMessage: string;
  /** True only when the household has zero items at all (not just zero
   * after filtering) — gates the richer "get started" empty state below. */
  isHouseholdEmpty?: boolean;
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  /** AUTO-2b(a): forwarded to the empty state's ItemFormDialog — see its
   * own doc comment in add-item-dialog.tsx. */
  aiCategoryFallbackEnabled?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [rawSelected, setSelected] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<BulkEditableField>("location");
  const [bulkValue, setBulkValue] = useState("");

  // Ids can go stale after a filter change or a bulk move that reassigns
  // the location facet being filtered on — derive the effective selection
  // by intersecting with what's actually visible, rather than syncing state
  // back with an effect.
  const selected = useMemo(() => {
    const visibleIds = new Set(items.map((item) => item.id));
    return new Set([...rawSelected].filter((id) => visibleIds.has(id)));
  }, [rawSelected, items]);

  if (items.length === 0 && isHouseholdEmpty) {
    return (
      <div className="flex flex-col items-center gap-6 rounded-md border border-dashed px-4 py-8 text-center sm:p-8">
        <div className="flex flex-col items-center gap-2">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Package className="size-6" />
          </span>
          <div>
            <p className="text-sm font-medium">{dict.emptyTitle}</p>
            <p className="text-sm text-muted-foreground">{dict.emptyLead}</p>
          </div>
        </div>
        <QuickAddBar dict={dict} categories={categories} units={units} />
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
          <ItemFormDialog
            mode="create"
            categories={categories}
            locations={locations}
            units={units}
            dict={dict}
            barcodeDict={barcodeDict}
            aiCategoryFallbackEnabled={aiCategoryFallbackEnabled}
            trigger={
              <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                {dict.addItem}
              </Button>
            }
          />
          <BulkScanDialog
            dict={dict}
            barcodeDict={barcodeDict}
            categories={categories}
            locations={locations}
            trigger={
              <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                {dict.bulkScan.triggerLabel}
              </Button>
            }
          />
          <BulkPasteDialog
            dict={dict}
            categories={categories}
            locations={locations}
            trigger={
              <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                {dict.pasteList.triggerLabel}
              </Button>
            }
          />
        </div>
        <div className="w-full border-t pt-6">
          <StarterKitPicker dict={dict} />
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  function handleMarkEmpty(item: InventoryItemRow, addToShoppingList: boolean) {
    startTransition(async () => {
      const result = await markItemEmptyAction(item.id, addToShoppingList);
      if (result.error) {
        toast.error(result.error);
      } else if (result.listName) {
        toast.success(format(dict.markedEmptyAddedToast, { name: item.name, list: result.listName }));
      } else {
        showAutoAddedToast(result.autoAdded, dict.autoAdd);
      }
    });
  }

  // GAP-28: applied straight away with an Undo on the toast (Guardrails'
  // "undo over confirm", same shape as MarkCookedDialog) — the server hands
  // back the fields it overwrote so Undo restores them exactly, plus the
  // openedAt it wrote so a stale Undo can recognise it's no longer current.
  function handleMarkOpened(item: InventoryItemRow) {
    startTransition(async () => {
      const result = await markItemOpenedAction(item.id);
      if (result.error || !result.openedAt || !result.expiresAt || !result.previous) {
        if (result.error) toast.error(result.error);
        return;
      }
      const { openedAt, previous } = result;
      const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(result.expiresAt);
      toast.success(format(dict.markedOpenedToast, { name: item.name, date }), {
        duration: 8000,
        action: {
          label: dict.undoMarkOpened,
          onClick: () => {
            void undoMarkItemOpenedAction(item.id, openedAt, previous).then((undoResult) => {
              if (undoResult.error) toast.error(undoResult.error);
              else toast.success(format(dict.markOpenedUndoneToast, { name: item.name }));
            });
          },
        },
      });
    });
  }

  function handleDelete(itemId: string) {
    startTransition(async () => {
      const result = await deleteInventoryItemAction(itemId);
      if (result.error) toast.error(result.error);
    });
  }

  function toggleItem(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((item) => item.id))));
  }

  // Category/location may be blank on purpose (clears back to "Uncategorized"
  // / unassigned, mirroring the single-item form); the other fields require
  // a real value since Prisma can't coerce an empty string into a number.
  function isBulkValueValid(field: BulkEditableField, value: string) {
    if (field === "quantity" || field === "lowStockThreshold") {
      return value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
    }
    if (field === "unit") return value.trim() !== "";
    return true;
  }

  function handleBulkApply() {
    if (selected.size === 0 || !isBulkValueValid(bulkField, bulkValue)) return;
    const ids = [...selected];
    const field = bulkField;
    const value = bulkValue;
    startTransition(async () => {
      const result = await bulkUpdateFieldAction(ids, field, value);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const count = result.updated ?? ids.length;
      toast.success(
        format(plural(count, dict.bulkActions.updatedToast), { count, field: fieldLabels[field] }),
      );
      showAutoAddedToast(result.autoAdded, dict.autoAdd);
      setBulkValue("");
    });
  }

  const fieldLabels: Record<BulkEditableField, string> = {
    category: dict.categoryLabel,
    location: dict.locationLabel,
    unit: dict.unitLabel,
    quantity: dict.quantityLabel,
    lowStockThreshold: dict.lowStockAtLabel,
  };

  const groups = groupItems(items, groupBy, dict);
  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="flex flex-col gap-2 sm:min-h-0 sm:flex-1">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 sm:shrink-0">
          <span className="text-sm font-medium">
            {format(plural(selected.size, dict.bulkActions.selectedCount), { count: selected.size })}
          </span>
          <Select
            value={bulkField}
            onValueChange={(v) => {
              setBulkField((v as BulkEditableField) ?? "location");
              setBulkValue("");
            }}
          >
            <SelectTrigger className="w-36" aria-label={dict.bulkActions.fieldAriaLabel}>
              <SelectValue>{(v: string) => fieldLabels[v as BulkEditableField]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {bulkEditableFields.map((f) => (
                <SelectItem key={f} value={f}>
                  {fieldLabels[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {bulkField === "quantity" || bulkField === "lowStockThreshold" ? (
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              className="h-8 w-28"
              aria-label={dict.bulkActions.valueAriaLabel}
            />
          ) : bulkField === "unit" ? (
            <Input
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              maxLength={20}
              className="h-8 w-28"
              aria-label={dict.bulkActions.valueAriaLabel}
            />
          ) : (
            <>
              <Input
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                placeholder={bulkField === "category" ? dict.categoryPlaceholder : dict.locationPlaceholder}
                maxLength={bulkField === "category" ? 60 : 120}
                list={`bulk-${bulkField}-options`}
                autoComplete="off"
                className="h-8 w-48"
                aria-label={dict.bulkActions.valueAriaLabel}
              />
              <datalist id={`bulk-${bulkField}-options`}>
                {(bulkField === "category" ? categories : locations).map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </>
          )}
          <Button
            size="sm"
            className="h-8"
            disabled={isPending || !isBulkValueValid(bulkField, bulkValue)}
            onClick={handleBulkApply}
          >
            {isPending ? dict.bulkActions.applying : dict.bulkActions.apply}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            disabled={isPending}
            onClick={() => setSelected(new Set())}
          >
            {dict.bulkActions.clearSelection}
          </Button>
        </div>
      )}
      <div className="hidden sm:block sm:min-h-0 sm:flex-1 roomy:overflow-y-auto">
      <Table>
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={allSelected}
              onChange={toggleSelectAll}
              aria-label={dict.bulkActions.selectAllAriaLabel}
            />
          </TableHead>
          <TableHead>{dict.columnName}</TableHead>
          <TableHead>{dict.columnCategory}</TableHead>
          <TableHead>{dict.columnLocation}</TableHead>
          <TableHead>{dict.columnQuantity}</TableHead>
          <TableHead>{dict.columnStatus}</TableHead>
          <TableHead>{dict.columnLastUpdated}</TableHead>
          <TableHead className="w-20" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <Fragment key={group.key || "__ungrouped__"}>
            {groupBy !== "none" && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="bg-muted/50 py-1.5 text-xs font-medium text-muted-foreground">
                  <span className="block max-w-[28rem] truncate" title={group.key}>
                    {group.key} <span className="text-muted-foreground/70">({group.items.length})</span>
                  </span>
                </TableCell>
              </TableRow>
            )}
            {group.items.map((item) => (
              <TableRow key={item.id} data-state={selected.has(item.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                    aria-label={format(dict.bulkActions.selectItemAriaLabel, { name: item.name })}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <span className="block max-w-[16rem] truncate" title={item.name}>
                    {item.name}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="block max-w-[10rem] truncate" title={item.category}>
                    {item.category}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="block max-w-[10rem] truncate" title={item.location ?? undefined}>
                    {item.location ?? "—"}
                  </span>
                </TableCell>
                <TableCell>
                  <QuantityStepper item={item} layout="table" disabled={isPending} dict={dict} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <StockBadge status={getStockStatus(item.quantity, item.lowStockThreshold)} dict={dict} />
                    <OnTheWayHint item={item} dict={dict} />
                    <ExpiryBadge
                      expiresAt={item.expiresAt}
                      expiresAtEstimated={item.expiresAtEstimated}
                      openedAt={item.openedAt}
                      dict={dict}
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <LastUpdatedCell item={item} members={members} locale={locale} dict={dict} />
                </TableCell>
                <TableCell>
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
                    onMarkEmpty={handleMarkEmpty}
                    onMarkOpened={handleMarkOpened}
                    onDelete={handleDelete}
                  />
                </TableCell>
              </TableRow>
            ))}
          </Fragment>
        ))}
      </TableBody>
      </Table>
      </div>

      {/* Mobile: a stacked card list instead of the table above — a 6-column
          table can't fit a 375px screen without horizontal scrolling, so
          phones get the same data reshaped into cards instead. */}
      <div className="flex min-w-0 flex-col gap-2 sm:hidden">
        {groups.map((group) => (
          <Fragment key={`m-${group.key || "__ungrouped__"}`}>
            {groupBy !== "none" && (
              <div className="min-w-0 rounded-md bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                <span className="block truncate" title={group.key}>
                  {group.key} <span className="text-muted-foreground/70">({group.items.length})</span>
                </span>
              </div>
            )}
            {group.items.map((item) => (
              <div
                key={item.id}
                data-state={selected.has(item.id) ? "selected" : undefined}
                className="flex min-w-0 flex-col gap-3 rounded-lg border p-3 data-[state=selected]:border-primary data-[state=selected]:bg-muted/40"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <Checkbox
                    checked={selected.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                    aria-label={format(dict.bulkActions.selectItemAriaLabel, { name: item.name })}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={item.name}>
                      {item.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.category}
                      {item.location ? ` • ${item.location}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <StockBadge status={getStockStatus(item.quantity, item.lowStockThreshold)} dict={dict} />
                    <OnTheWayHint item={item} dict={dict} />
                    <ExpiryBadge
                      expiresAt={item.expiresAt}
                      expiresAtEstimated={item.expiresAtEstimated}
                      openedAt={item.openedAt}
                      dict={dict}
                    />
                  </div>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <QuantityStepper item={item} layout="card" disabled={isPending} dict={dict} />
                  <div className="shrink-0">
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
                      onMarkEmpty={handleMarkEmpty}
                      onMarkOpened={handleMarkOpened}
                      onDelete={handleDelete}
                      size="size-9"
                    />
                  </div>
                </div>
                <LastUpdatedCell item={item} members={members} locale={locale} dict={dict} />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// The row's −/+ stepper (desktop table cell or phone card). UX-14: each tap
// moves the number at once, in this row's own transition, so tapping + three
// times on a slow connection shows 3 more straight away instead of nothing
// until the first save lands, and other rows stay usable meanwhile. The
// optimistic step uses the server's own rounding and zero floor
// (nextQuantityAfterDelta), so the number it shows is the one that saves; a
// failed save snaps back to the server's value with a toast. The stock badge
// beside it follows once the save revalidates the page.
function QuantityStepper({
  item,
  layout,
  disabled,
  dict,
}: {
  item: InventoryItemRow;
  layout: "table" | "card";
  disabled: boolean;
  dict: Dictionary["inventory"];
}) {
  const [, startTransition] = useTransition();
  const [quantity, addOptimisticDelta] = useOptimistic(item.quantity, nextQuantityAfterDelta);
  const label = `${formatQuantity(quantity)} ${item.unit}`;

  function adjust(delta: number) {
    startTransition(async () => {
      addOptimisticDelta(delta);
      const result = await settleOptimisticAction(() => adjustQuantityAction(item.id, delta), dict.saveFailedToast);
      if (result) showAutoAddedToast(result.autoAdded, dict.autoAdd);
    });
  }

  const isTable = layout === "table";
  const buttonClass = isTable ? "size-7" : "shrink-0";
  return (
    <div className={isTable ? "flex items-center gap-2" : "flex min-w-0 shrink items-center gap-1.5"}>
      <Button
        variant="outline"
        size="icon"
        className={buttonClass}
        disabled={disabled}
        aria-label={format(dict.decreaseQuantityAriaLabel, { name: item.name })}
        onClick={() => adjust(-1)}
      >
        <Minus className="size-3.5" />
      </Button>
      {/* Fixed width in the table, capped (not flex-1) on a card, so the
          control stays a tight cluster and a long/custom unit string
          truncates instead of forcing the row wider. */}
      <span
        className={
          isTable
            ? "block w-14 shrink-0 truncate text-center tabular-nums"
            : "max-w-24 truncate text-center text-sm tabular-nums"
        }
        title={label}
      >
        {label}
      </span>
      <Button
        variant="outline"
        size="icon"
        className={buttonClass}
        disabled={disabled}
        aria-label={format(dict.increaseQuantityAriaLabel, { name: item.name })}
        onClick={() => adjust(1)}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

// The inventory side of the put-away flow: stock ticked off a shopping list
// that hasn't been put away yet. Muted text rather than a badge, since it's
// context for the stock badge beside it, not a status of its own.
function OnTheWayHint({ item, dict }: { item: InventoryItemRow; dict: Dictionary["inventory"] }) {
  if (!item.incoming || item.incoming <= 0) return null;
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {format(dict.onTheWay, { amount: `${formatQuantity(item.incoming)} ${item.unit}` })}
    </span>
  );
}
