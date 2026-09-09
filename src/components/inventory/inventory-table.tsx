"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { Ban, Minus, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  bulkUpdateFieldAction,
  deleteInventoryItemAction,
  markItemEmptyAction,
} from "@/app/dashboard/inventory/actions";
import { bulkEditableFields, type BulkEditableField } from "@/lib/inventory/bulk-editable-fields";
import { ItemFormDialog } from "@/components/inventory/add-item-dialog";
import { QuickAddBar } from "@/components/inventory/quick-add-bar";
import { StarterKitPicker } from "@/components/inventory/starter-kit-picker";
import { getStockStatus, type StockStatus } from "@/lib/stock-status";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type InventoryItemRow = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  location: string | null;
  updatedAt: Date;
  updatedByUserId: string | null;
};

export type HouseholdMemberOption = { userId: string; displayName: string };

export type InventoryGroupBy = "none" | "category" | "location" | "both";

// Bucketed "last updated" ranges the filter dropdown offers — see
// matchesUpdatedFilter below. Kept as a plain union (not derived from the
// dict) so InventoryClient's filtering logic doesn't depend on translations.
export type UpdatedFilter = "all" | "today" | "week" | "stale30" | "stale90";

const DAY_MS = 24 * 60 * 60 * 1000;

export function matchesUpdatedFilter(item: InventoryItemRow, filter: UpdatedFilter, now: number): boolean {
  const ageMs = now - item.updatedAt.getTime();
  switch (filter) {
    case "today":
      return ageMs < DAY_MS;
    case "week":
      return ageMs < 7 * DAY_MS;
    case "stale30":
      return ageMs >= 30 * DAY_MS;
    case "stale90":
      return ageMs >= 90 * DAY_MS;
    default:
      return true;
  }
}

// Renders the "Last updated" cell: a compact date plus, when resolvable, who
// last touched the item — with the full sentence in a tooltip since the
// column itself only has room for the date.
function LastUpdatedCell({
  item,
  members,
  locale,
  dict,
}: {
  item: InventoryItemRow;
  members: HouseholdMemberOption[];
  locale: Locale;
  dict: Dictionary["inventory"];
}) {
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const dateLabel = dateFormat.format(item.updatedAt);
  const updaterName = members.find((m) => m.userId === item.updatedByUserId)?.displayName;
  const fullLabel = updaterName
    ? format(dict.lastUpdatedWithUser, { date: dateLabel, name: updaterName })
    : format(dict.lastUpdatedNoUser, { date: dateLabel });

  return (
    <span className="block text-muted-foreground" title={fullLabel}>
      {dateLabel}
    </span>
  );
}

// Re-exported for existing consumers (InventoryClient) — the real
// implementation now lives in `@/lib/stock-status` so it's importable from
// Server Components too (see that file's comment for why).
export { getStockStatus, type StockStatus };

function StockBadge({ status, dict }: { status: StockStatus; dict: Dictionary["inventory"] }) {
  if (status === "out") return <Badge variant="destructive">{dict.statusOut}</Badge>;
  if (status === "low") return <Badge className="bg-amber-500 text-white">{dict.statusLow}</Badge>;
  return <Badge variant="secondary">{dict.statusIn}</Badge>;
}

// Shared between the desktop table row and the mobile card (see
// InventoryTable below) so the mark-empty/edit/delete cluster — and its
// touch-target sizing — only needs to be defined once.
function ItemActions({
  item,
  categories,
  locations,
  units,
  members,
  locale,
  dict,
  barcodeDict,
  isPending,
  onMarkEmpty,
  onDelete,
  size = "size-7",
}: {
  item: InventoryItemRow;
  categories: string[];
  locations: string[];
  units: string[];
  members: HouseholdMemberOption[];
  locale: Locale;
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  isPending: boolean;
  onMarkEmpty: (item: InventoryItemRow, addToShoppingList: boolean) => void;
  onDelete: (itemId: string) => void;
  size?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={cn(size, "text-muted-foreground")}
              disabled={isPending}
              aria-label={dict.markEmptyAriaLabel}
            >
              <Ban className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onMarkEmpty(item, false)}>{dict.markEmpty}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMarkEmpty(item, true)}>
            {dict.markEmptyAndAddToList}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ItemFormDialog
        mode="edit"
        item={item}
        categories={categories}
        locations={locations}
        units={units}
        members={members}
        locale={locale}
        dict={dict}
        barcodeDict={barcodeDict}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className={cn(size, "text-muted-foreground")}
            aria-label={dict.editAriaLabel}
          >
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        className={cn(size, "text-muted-foreground hover:text-destructive")}
        disabled={isPending}
        onClick={() => onDelete(item.id)}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
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
        <QuickAddBar dict={dict} />
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
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      disabled={isPending}
                      onClick={() => handleAdjustQuantity(item.id, -1)}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    {/* min-w-0 + flex-1 (not shrink-0) lets a long/custom unit
                        string truncate instead of forcing the row — and the
                        page — wider than the viewport; see the desktop
                        table's equivalent w-14 cell for the same fix. */}
                    <span
                      className="min-w-0 flex-1 truncate text-center text-sm tabular-nums"
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
