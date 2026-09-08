"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { Ban, Minus, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  bulkUpdateLocationAction,
  deleteInventoryItemAction,
  markItemEmptyAction,
} from "@/app/dashboard/inventory/actions";
import { ItemFormDialog } from "@/components/inventory/add-item-dialog";
import { QuickAddBar } from "@/components/inventory/quick-add-bar";
import { StarterKitPicker } from "@/components/inventory/starter-kit-picker";
import { getStockStatus, type StockStatus } from "@/lib/stock-status";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type InventoryItemRow = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  location: string | null;
};

export type InventoryGroupBy = "none" | "category" | "location" | "both";

// Re-exported for existing consumers (InventoryClient) — the real
// implementation now lives in `@/lib/stock-status` so it's importable from
// Server Components too (see that file's comment for why).
export { getStockStatus, type StockStatus };

function StockBadge({ status, dict }: { status: StockStatus; dict: Dictionary["inventory"] }) {
  if (status === "out") return <Badge variant="destructive">{dict.statusOut}</Badge>;
  if (status === "low") return <Badge className="bg-amber-500 text-white">{dict.statusLow}</Badge>;
  return <Badge variant="secondary">{dict.statusIn}</Badge>;
}

function groupKeyFor(item: InventoryItemRow, groupBy: InventoryGroupBy, dict: Dictionary["inventory"]) {
  const location = item.location || dict.noLocation;
  if (groupBy === "category") return item.category;
  if (groupBy === "location") return location;
  if (groupBy === "both") return `${item.category} • ${location}`;
  return "";
}

// Groups items by the chosen key while keeping each group's items in their
// incoming order (already name-sorted by the server/filter). Groups
// themselves are sorted alphabetically so the table stays scannable no
// matter which grouping is picked.
function groupItems(items: InventoryItemRow[], groupBy: InventoryGroupBy, dict: Dictionary["inventory"]) {
  if (groupBy === "none") return [{ key: "", items }];

  const groups = new Map<string, InventoryItemRow[]>();
  for (const item of items) {
    const key = groupKeyFor(item, groupBy, dict);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, groupedItems]) => ({ key, items: groupedItems }));
}

export function InventoryTable({
  items,
  categories,
  locations,
  groupBy = "none",
  emptyMessage,
  isHouseholdEmpty = false,
  dict,
  barcodeDict,
}: {
  items: InventoryItemRow[];
  categories: string[];
  locations: string[];
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
  const [bulkLocation, setBulkLocation] = useState("");

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
        <QuickAddBar dict={dict} />
        <ItemFormDialog
          mode="create"
          categories={categories}
          locations={locations}
          dict={dict}
          barcodeDict={barcodeDict}
          trigger={
            <Button variant="link" size="sm" className="h-auto p-0 text-xs">
              {dict.addItem}
            </Button>
          }
        />
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

  function handleBulkApply() {
    const location = bulkLocation.trim();
    if (!location || selected.size === 0) return;
    const ids = [...selected];
    startTransition(async () => {
      const result = await bulkUpdateLocationAction(ids, location);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const count = result.updated ?? ids.length;
      toast.success(
        format(plural(count, dict.bulkActions.movedToast), { count, location }),
      );
      setSelected(new Set());
      setBulkLocation("");
    });
  }

  const groups = groupItems(items, groupBy, dict);
  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="flex flex-col gap-2">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">
            {format(plural(selected.size, dict.bulkActions.selectedCount), { count: selected.size })}
          </span>
          <Input
            value={bulkLocation}
            onChange={(e) => setBulkLocation(e.target.value)}
            placeholder={dict.bulkActions.locationPlaceholder}
            list="bulk-location-options"
            autoComplete="off"
            className="h-8 w-48"
          />
          <datalist id="bulk-location-options">
            {locations.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <Button
            size="sm"
            className="h-8"
            disabled={isPending || !bulkLocation.trim()}
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
          <TableHead className="w-20" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <Fragment key={group.key || "__ungrouped__"}>
            {groupBy !== "none" && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="bg-muted/50 py-1.5 text-xs font-medium text-muted-foreground">
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
                    <span className="w-14 text-center tabular-nums">
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
                  <div className="flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground"
                            disabled={isPending}
                            aria-label={dict.markEmptyAriaLabel}
                          >
                            <Ban className="size-3.5" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleMarkEmpty(item, false)}>
                          {dict.markEmpty}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleMarkEmpty(item, true)}>
                          {dict.markEmptyAndAddToList}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <ItemFormDialog
                      mode="edit"
                      item={item}
                      categories={categories}
                      locations={locations}
                      dict={dict}
                      barcodeDict={barcodeDict}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          aria-label={dict.editAriaLabel}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      disabled={isPending}
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </Fragment>
        ))}
      </TableBody>
      </Table>
    </div>
  );
}
