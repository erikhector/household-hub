"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { Minus, Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
} from "@/app/dashboard/inventory/actions";
import { bulkEditableFields, type BulkEditableField } from "@/lib/inventory/bulk-editable-fields";
import { ItemFormDialog } from "@/components/inventory/add-item-dialog";
import { QuickAddBar } from "@/components/inventory/quick-add-bar";
import { StarterKitPicker } from "@/components/inventory/starter-kit-picker";
import { BulkScanDialog } from "@/components/inventory/bulk-scan-dialog";
import { BulkPasteDialog } from "@/components/inventory/bulk-paste-dialog";
import { StockBadge } from "@/components/inventory/stock-badge";
import { ItemActions } from "@/components/inventory/item-actions";
import { LastUpdatedCell } from "@/components/inventory/last-updated-cell";
import { getStockStatus } from "@/lib/stock-status";
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
      <div className="flex flex-col items-center gap-6 rounded-md border border-dashed p-8 text-center">
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
      }
    });
  }

  function handleAdjustQuantity(itemId: string, delta: number) {
    startTransition(async () => {
      const result = await adjustQuantityAction(itemId, delta);
      if (result.error) toast.error(result.error);
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
    <div className="flex flex-col gap-2">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
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
            <SelectTrigger className="w-36">
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
              min={0}
              step="any"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              className="h-8 w-28"
            />
          ) : bulkField === "unit" ? (
            <Input
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              maxLength={20}
              className="h-8 w-28"
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
      <div className="hidden sm:block">
      <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <input
              type="checkbox"
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
                  <input
                    type="checkbox"
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
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      disabled={isPending}
                      onClick={() => handleAdjustQuantity(item.id, -1)}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <span
                      className="block w-14 shrink-0 truncate text-center tabular-nums"
                      title={`${item.quantity} ${item.unit}`}
                    >
                      {item.quantity} {item.unit}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      disabled={isPending}
                      onClick={() => handleAdjustQuantity(item.id, 1)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <StockBadge status={getStockStatus(item.quantity, item.lowStockThreshold)} dict={dict} />
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
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                    aria-label={format(dict.bulkActions.selectItemAriaLabel, { name: item.name })}
                    className="mt-1 size-4 shrink-0"
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
                  <StockBadge status={getStockStatus(item.quantity, item.lowStockThreshold)} dict={dict} />
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 shrink items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      disabled={isPending}
                      onClick={() => handleAdjustQuantity(item.id, -1)}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    {/* Capped (not flex-1) so the control stays a tight
                        cluster instead of stretching across the row — a long/
                        custom unit string still truncates instead of forcing
                        the row wider; see the desktop table's w-14 cell for
                        the same fix. */}
                    <span
                      className="max-w-24 truncate text-center text-sm tabular-nums"
                      title={`${item.quantity} ${item.unit}`}
                    >
                      {item.quantity} {item.unit}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      disabled={isPending}
                      onClick={() => handleAdjustQuantity(item.id, 1)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
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
