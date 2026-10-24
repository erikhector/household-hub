"use client";

import { Fragment, useMemo, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { Minus, Plus, ShoppingCart, X } from "lucide-react";
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
} from "@/app/dashboard/inventory/actions";
import { bulkEditableFields, type BulkEditableField } from "@/lib/inventory/bulk-editable-fields";
import { ItemFormDialog } from "@/components/inventory/add-item-dialog";
import { QuickAddDisclosure } from "@/components/inventory/quick-add-bar";
import { StarterKitPicker } from "@/components/inventory/starter-kit-picker";
import { Badge } from "@/components/ui/badge";
import { StockBadge } from "@/components/inventory/stock-badge";
import { ExpiryBadge } from "@/components/inventory/expiry-badge";
import { ItemActions } from "@/components/inventory/item-actions";
import { useItemHandlers } from "@/components/inventory/use-item-handlers";
import { LastUpdatedCell } from "@/components/inventory/last-updated-cell";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { SwipeRow } from "@/components/shared/swipe-row";
import { startUndoableDelete } from "@/components/shared/start-undoable-delete";
import { getStockStatus } from "@/lib/stock-status";
import { nextQuantityAfterDelta } from "@/lib/inventory/stock-change";
import { quantityStep } from "@/lib/inventory/quantity-step";
import { QuantitySheet } from "@/components/inventory/quantity-sheet";
import { formatQuantity } from "@/lib/format-quantity";
import {
  groupItems,
  type HouseholdMemberOption,
  type InventoryGroupBy,
  type InventoryItemRow,
} from "@/components/inventory/inventory-table-utils";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { useUnitLabel } from "@/components/units-provider";
import { PendingLabel } from "@/components/ui/pending-label";
import { applyLocalRowChanges, settleDelete, useLocalRowChanges } from "@/components/shared/local-row-changes";
import { useFlipList } from "@/components/shared/use-flip-list";
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";

export type { HouseholdMemberOption, InventoryGroupBy, InventoryItemRow };

export function InventoryTable({
  items: serverItems,
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
  autoAddEnabled = false,
  view,
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
  /** UX-122: the household's low-stock auto-add setting — see ItemActions. */
  autoAddEnabled?: boolean;
  /** The search, filters and grouping being shown: changing it isn't a row
   * coming or going, so the rows don't animate (useFlipList). */
  view?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const { handleMarkEmpty, handleMarkOpened, handleFreeze, addToShoppingList } = useItemHandlers({
    dict,
    locale,
    run: (action) => startTransition(action),
  });
  // UX-33: a deleted item leaves the list at tap time (see
  // local-row-changes.ts) and the rows below glide up; it comes back if
  // the delete fails.
  const local = useLocalRowChanges(serverItems);
  const items = applyLocalRowChanges(serverItems, local.changes, (item) => item);
  const containerRef = useFlipList<HTMLDivElement>(view);
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
    // UX-50: the same empty state as every other section: the mascot, one
    // line on why, one primary ("Add item", through PrimaryAction, so on a
    // phone it floats where the header's FAB would). Scanning and pasting
    // are in the header and the ⋯ menu; the quick row and the starter kits
    // sit below the box, quieter, and clear of the floating button.
    return (
      <div className="flex flex-col gap-6">
        <MascotEmptyState
          alt={dict.mascotAlt}
          action={
            <ItemFormDialog
              mode="create"
              categories={categories}
              locations={locations}
              units={units}
              dict={dict}
              barcodeDict={barcodeDict}
              aiCategoryFallbackEnabled={aiCategoryFallbackEnabled}
              trigger={
                <Button className="gap-1.5">
                  <Plus className="size-4" />
                  {dict.addItem}
                </Button>
              }
            />
          }
        >
          <div>
            <p className="text-sm font-medium">{dict.emptyTitle}</p>
            <p className="text-sm text-muted-foreground">{dict.emptyLead}</p>
          </div>
        </MascotEmptyState>
        <div className="flex flex-col items-center gap-6 text-center">
          <QuickAddDisclosure dict={dict} categories={categories} units={units} />
          <div className="w-full border-t pt-6">
            <StarterKitPicker dict={dict} />
          </div>
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

  function handleAddToList(item: InventoryItemRow) {
    addToShoppingList([item.id]);
  }

  // UX-49: the ⋯ menu's and the desktop trash's Delete hide the row at once
  // and offer Undo, as the swipe does. A bulk delete inside the window would
  // race the deferred one, so the item also leaves the selection.
  function handleDelete(item: InventoryItemRow) {
    setSelected((prev) => {
      if (!prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    const settle = local.markDeleted(item.id);
    startUndoableDelete({
      run: async () => {
        const result = await settleDelete(settle, deleteInventoryItemAction(item.id), dict.saveFailedToast);
        if (result.error) toast.error(result.error);
        return !result.error;
      },
      restore: () => settle(false),
      message: format(dict.swipe.deletedToast, { name: item.name }),
      undoLabel: dict.swipe.undo,
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
    lowStockThreshold: dict.runningLowBelowLabel,
  };

  const groups = groupItems(items, groupBy, dict);
  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div ref={containerRef} className="flex flex-col gap-2 sm:min-h-0 sm:flex-1">
      {selected.size > 0 && (
        // UX-123: on phones the bar is a toolbar docked to the top of the
        // bottom bar, full width, in two rows: what's selected and the
        // quick actions, then the field edit. It used to be a sticky card
        // that wrapped to three rows, floated over the middle of the list
        // with rows showing below it, and left a gap above the Add-item
        // button. `fixed` is the same footing PrimaryAction stands on; the
        // offset is BottomNav's height (layout.tsx). While it's up,
        // globals.css hides the Add-item button (adding isn't the task
        // while a selection is open, and the two fought for the same
        // corner) and makes <main> reserve the bar's height instead, so the
        // last row still scrolls out from under it. From `sm` it's one
        // wrapping row above the table, as before: each row's groups are
        // `sm:contents`, and Clear selection is ordered last.
        <div
          data-bulk-bar=""
          className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 sm:shrink-0 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[calc(3.75rem+min(2.125rem,env(safe-area-inset-bottom))+var(--cookie-notice-h,0px))] max-sm:z-30 max-sm:flex-col max-sm:flex-nowrap max-sm:items-stretch max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 max-sm:bg-background max-sm:pr-[max(1rem,env(safe-area-inset-right))] max-sm:pl-[max(1rem,env(safe-area-inset-left))] max-sm:shadow-[0_-4px_12px_-6px_rgb(0_0_0/0.25)] print:hidden"
        >
          <div className="flex items-center gap-2 sm:contents">
            <span className="text-sm font-medium max-sm:min-w-0 max-sm:flex-1 max-sm:truncate">
              {format(plural(selected.size, dict.bulkActions.selectedCount), { count: selected.size })}
            </span>
            {!allSelected && (
              <Button variant="ghost" size="sm" className="h-8 max-sm:h-11" disabled={isPending} onClick={toggleSelectAll}>
                {dict.bulkActions.selectAll}
              </Button>
            )}
            {/* Icon-only on phones, where the label doesn't fit beside the
                count; the cart is the same one the row menu uses for this
                action, and the label stays as the accessible name. */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 max-sm:size-11 max-sm:p-0"
              disabled={isPending}
              onClick={() => addToShoppingList([...selected], () => setSelected(new Set()))}
            >
              <ShoppingCart aria-hidden className="sm:hidden" />
              <span className="max-sm:sr-only">{dict.addToList.bulk}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground sm:order-last max-sm:size-11 max-sm:p-0"
              disabled={isPending}
              onClick={() => setSelected(new Set())}
            >
              <X aria-hidden className="sm:hidden" />
              <span className="max-sm:sr-only">{dict.bulkActions.clearSelection}</span>
            </Button>
          </div>
          <div className="flex items-center gap-2 sm:contents">
            <Select
              value={bulkField}
              onValueChange={(v) => {
                setBulkField((v as BulkEditableField) ?? "location");
                setBulkValue("");
              }}
            >
              <SelectTrigger className="w-36 max-sm:h-11 max-sm:shrink-0" aria-label={dict.bulkActions.fieldAriaLabel}>
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
                className="h-8 w-28 max-sm:h-11 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1"
                aria-label={dict.bulkActions.valueAriaLabel}
              />
            ) : bulkField === "unit" ? (
              <Input
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                maxLength={20}
                className="h-8 w-28 max-sm:h-11 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1"
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
                  className="h-8 w-48 max-sm:h-11 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1"
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
              className="h-8 max-sm:h-11 max-sm:shrink-0"
              disabled={isPending || !isBulkValueValid(bulkField, bulkValue)}
              onClick={handleBulkApply}
            >
              <PendingLabel pending={isPending} busy={dict.bulkActions.applying} idle={dict.bulkActions.apply} />
            </Button>
          </div>
        </div>
      )}
      <div className="hidden lg:block lg:min-h-0 lg:flex-1 roomy:overflow-y-auto">
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
              <TableRow data-flip-key={`label:${group.key}`} className="hover:bg-transparent">
                <TableCell colSpan={8} className="bg-muted/50 py-1.5 text-xs font-medium text-muted-foreground">
                  <span className="block max-w-[28rem] truncate" title={group.key}>
                    {group.key} <span className="text-muted-foreground/70">({group.items.length})</span>
                  </span>
                </TableCell>
              </TableRow>
            )}
            {group.items.map((item) => (
              <TableRow key={item.id} data-flip-key={item.id} data-state={selected.has(item.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                    aria-label={format(dict.bulkActions.selectItemAriaLabel, { name: item.name })}
                  />
                </TableCell>
                {/* UX-130: the three text columns take a share of the table
                    (w-[%]) and have max-w-0, so their min-content width is
                    zero and the text truncates to the share. Fixed caps
                    (16rem name, 10rem the others) made the table 1054 px
                    wide in the ~990 px column a 1280 px screen leaves next
                    to the sidebar, and a row with seven icons pushed the
                    last one, Delete, off screen. The full text is in the
                    cell's title. */}
                <TableCell className="w-[16%] max-w-0 font-medium">
                  <span className="block truncate" title={item.name}>
                    {item.name}
                  </span>
                </TableCell>
                <TableCell className="w-[10%] max-w-0 text-muted-foreground">
                  <span className="block truncate" title={item.category}>
                    {item.category}
                  </span>
                </TableCell>
                <TableCell className="w-[10%] max-w-0 text-muted-foreground">
                  <span className="block truncate" title={item.location ?? undefined}>
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
                    <OnListTag item={item} dict={dict} />
                    <ExpiryBadge
                      expiresAt={item.expiresAt}
                      expiresAtEstimated={item.expiresAtEstimated}
                      openedAt={item.openedAt}
                      frozenAt={item.frozenAt}
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
                    autoAddEnabled={autoAddEnabled}
                    onAddToList={handleAddToList}
                    onMarkEmpty={handleMarkEmpty}
                    onMarkOpened={handleMarkOpened}
                    onFreeze={handleFreeze}
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

      {/* Mobile: a compact list instead of the table above — a 6-column
          table can't fit a 375px screen without horizontal scrolling, so
          phones get the same data reshaped into rows. UX-45: each row is
          two lines (name, place and badges; stepper and actions), about
          80px, so eight or more fit on a Pixel 7 where the old three-row
          cards fitted under five. "Last updated" isn't on the row: it was
          the same line on every item and the least useful one, so it lives
          on the item page (Details in the ⋯ menu) instead. The checkbox
          sits in its own column, centred on both lines, 14px from the
          content: its 44px tap halo reaches 14px past the box (see
          checkbox.tsx), so nearer than that it would sit over the − button
          and swallow taps meant for it. A selected row gets a primary
          accent down its left edge as well as a tint: the rows share one
          border now, so there's no per-card border to colour, and a tint
          alone is hard to see in sunlight. */}
      <div className="flex min-w-0 flex-col gap-2 lg:hidden">
        {groups.map((group) => (
          <Fragment key={`m-${group.key || "__ungrouped__"}`}>
            {groupBy !== "none" && (
              <div data-flip-key={`card-label:${group.key}`} className="list-bleed min-w-0 rounded-md bg-muted/50 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                <span className="block truncate" title={group.key}>
                  {group.key} <span className="text-muted-foreground/70">({group.items.length})</span>
                </span>
              </div>
            )}
            {/* overflow-hidden here, not on each SwipeRow: the list's
                rounded border clips a row's swipe underlay at its corners. */}
            <ul
              data-flip-key={`card-group:${group.key}`}
              className="list-bleed relative min-w-0 divide-y overflow-hidden rounded-lg border"
            >
              {group.items.map((item) => (
                <SwipeableItemCard
                  key={item.id}
                  item={item}
                  disabled={isPending}
                  dict={dict}
                  onDelete={handleDelete}
                >
                  {/* The selected tint and accent sit on this row, inside
                      SwipeRow's opaque sliding layer, not on the <li> under
                      it where that layer would hide them. pl-3.5 keeps the
                      checkbox's 14px tap halo inside SwipeRow's
                      overflow-hidden, which would otherwise clip its left
                      edge. */}
                  <div
                    data-state={selected.has(item.id) ? "selected" : undefined}
                    className="flex min-w-0 items-center gap-3.5 py-1.5 pr-2 pl-3.5 data-[state=selected]:bg-primary/10 data-[state=selected]:shadow-[inset_3px_0_0_var(--color-primary)]"
                  >
                    <Checkbox
                      checked={selected.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      aria-label={format(dict.bulkActions.selectItemAriaLabel, { name: item.name })}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      {/* The row wraps and the name keeps a floor, so at 200% text the badge cluster drops under the name (and its badges wrap inside it; Badge is nowrap and shrink-0 by default) instead of squeezing the name to nothing or spilling over it. */}
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="min-w-[40%] flex-1 truncate" title={item.name}>
                          <span className="font-medium">{item.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {" · "}
                            {item.category}
                            {item.location ? ` • ${item.location}` : ""}
                          </span>
                        </p>
                        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 [&>*]:h-auto [&>*]:max-w-full [&>*]:whitespace-normal">
                          <StockBadge status={getStockStatus(item.quantity, item.lowStockThreshold)} dict={dict} />
                          <OnTheWayHint item={item} dict={dict} />
                          <OnListTag item={item} dict={dict} />
                          <ExpiryBadge
                            expiresAt={item.expiresAt}
                            expiresAtEstimated={item.expiresAtEstimated}
                            openedAt={item.openedAt}
                            frozenAt={item.frozenAt}
                            dict={dict}
                          />
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <QuantityStepper item={item} layout="card" disabled={isPending} dict={dict} />
                        <div className="ml-auto min-w-0">
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
                            onAddToList={handleAddToList}
                            onMarkEmpty={handleMarkEmpty}
                            onMarkOpened={handleMarkOpened}
                            onFreeze={handleFreeze}
                            onDelete={handleDelete}
                            size="size-9"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </SwipeableItemCard>
              ))}
            </ul>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// UX-35: the phone card's swipe actions: left for Edit and a Delete with
// Undo (the ⋯ menu and trash do the same, UX-49, through handleDelete). No
// right swipe: its +1 sat right next to the card's own + button, an easier
// tap than a 40% swipe, and a swipe that adds stock by accident is worse
// than one that does nothing. Phones only: the desktop table is for a
// mouse, where SwipeRow does nothing anyway.
function SwipeableItemCard({
  item,
  disabled,
  dict,
  onDelete,
  children,
}: {
  item: InventoryItemRow;
  disabled: boolean;
  dict: Dictionary["inventory"];
  onDelete: (item: InventoryItemRow) => void;
  children: ReactNode;
}) {
  // The <li> lives here, not in the list, so a deleted row leaves no empty
  // item behind for the list's divide-y to draw a border around.
  return (
    <li data-flip-key={`card:${item.id}`}>
      <SwipeRow
        editLabel={dict.swipe.edit}
        deleteLabel={dict.swipe.delete}
        onDelete={() => onDelete(item)}
        disabled={disabled}
      >
        {children}
      </SwipeRow>
    </li>
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
// UX-119: a tap moves by a step that suits the unit (50 g, not 1 g), and
// tapping the number opens the "I used some / I bought more" sheet for an
// exact amount.
export function QuantityStepper({
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
  const unitLabel = useUnitLabel();
  const [, startTransition] = useTransition();
  const [quantity, addOptimisticDelta] = useOptimistic(item.quantity, nextQuantityAfterDelta);
  const [sheetOpen, setSheetOpen] = useState(false);
  const label = `${formatQuantity(quantity)} ${unitLabel(item.unit)}`;
  const step = quantityStep(item.unit);

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
    <div className={isTable ? "flex items-center gap-2" : "flex min-w-0 shrink items-center gap-2"}>
      <Button
        variant="ghost"
        size="icon"
        className={buttonClass}
        disabled={disabled}
        aria-label={format(dict.decreaseQuantityAriaLabel, { name: item.name })}
        title={format(dict.decreaseQuantityAriaLabel, { name: item.name })}
        onClick={() => adjust(-step)}
      >
        <Minus className="size-3.5" />
      </Button>
      {/* Fixed width in the table, capped (not flex-1) on a card, so the
          control stays a tight cluster and a long/custom unit string
          truncates instead of forcing the row wider. */}
      <Button
        variant="ghost"
        size="sm"
        className={
          isTable
            ? "block w-14 shrink-0 truncate px-0 text-center text-sm font-normal tabular-nums"
            : "max-w-24 truncate px-1 text-center text-sm font-normal tabular-nums"
        }
        disabled={disabled}
        aria-label={format(dict.quantitySheet.openAriaLabel, { name: item.name, amount: label })}
        title={label}
        onClick={() => setSheetOpen(true)}
      >
        {label}
      </Button>
      <QuantitySheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        itemId={item.id}
        itemName={item.name}
        quantity={quantity}
        unitText={unitLabel(item.unit)}
        unit={item.unit}
        onApply={adjust}
        dict={dict.quantitySheet}
      />
      <Button
        variant="ghost"
        size="icon"
        className={buttonClass}
        disabled={disabled}
        aria-label={format(dict.increaseQuantityAriaLabel, { name: item.name })}
        title={format(dict.increaseQuantityAriaLabel, { name: item.name })}
        onClick={() => adjust(step)}
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
  const unitLabel = useUnitLabel();
  if (!item.incoming || item.incoming <= 0) return null;
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {format(dict.onTheWay, { amount: `${formatQuantity(item.incoming)} ${unitLabel(item.unit)}` })}
    </span>
  );
}

// UX-122: the item is already on an active shopping list, so adding it again
// would be a no-op and a person buying it can see it's covered.
function OnListTag({ item, dict }: { item: InventoryItemRow; dict: Dictionary["inventory"] }) {
  if (!item.onList) return null;
  return (
    <Badge variant="outline" className="text-xs">
      {dict.addToList.onList}
    </Badge>
  );
}
