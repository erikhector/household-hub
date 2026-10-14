"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  Check,
  CheckCheck,
  ClipboardPaste,
  Download,
  Ellipsis,
  Link2,
  PackageCheck,
  PackagePlus,
  Plus,
  Printer,
  RotateCcw,
  ScrollText,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createDialogHandle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShoppingItemFormDialog } from "@/components/shopping/shopping-item-form-dialog";
import { ReceiptScanDialog } from "@/components/shopping/receipt-scan-dialog";
import { ResolveMappingsDialog } from "@/components/shopping/resolve-mappings-dialog";
import { ImportListDialog } from "@/components/shopping/import-list-dialog";
import { ShareListButton } from "@/components/shopping/share-list-button";
import { SmartAddBar } from "@/components/shopping/smart-add-bar";
import { CategoryChip } from "@/components/shopping/category-chip";
import { ReorderSectionsDialog } from "@/components/shopping/reorder-sections-dialog";
import { SaveTemplateDialog } from "@/components/shopping/list-templates";
import { PutAwayDialog } from "@/components/shopping/put-away-dialog";
import {
  archiveShoppingListAction,
  completeShoppingListAction,
  deleteShoppingListAction,
  deleteShoppingListItemAction,
  generateFromLowStockAction,
  resetCategoryOrderAction,
  saveCategoryOrderAction,
  togglePurchasedAction,
  unarchiveShoppingListAction,
  uncompleteShoppingListAction,
  updateShoppingListItemPriceAction,
} from "@/app/dashboard/shopping-list/actions";
import { format, plural } from "@/lib/i18n/format";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { cn } from "@/lib/utils";
import type { SmartAddCandidate } from "@/lib/shopping/smart-add-suggestions";
import { groupPendingItemsByCategory, type ShoppingModeGroup } from "@/lib/shopping/shopping-mode-grouping";
import type { StoreOrder } from "@/lib/shopping/store-order";
import { sumEstimatedPendingTotal } from "@/lib/shopping/estimated-total";
import { useScreenWakeLock } from "@/lib/shopping/use-screen-wake-lock";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";
import { awaitsReceiptPrice, isAwaitingPutAway, withLocalTick } from "@/lib/shopping/put-away-calc";
import { applyLocalRowChanges, useLocalRowChanges } from "@/components/shared/local-row-changes";
import { useFlipList } from "@/components/shared/use-flip-list";
import { MorphTitle } from "@/components/shared/view-transitions";
import type { ItemAliasLike } from "@/lib/item-alias";
import { useUnitLabel } from "@/components/units-provider";

// Below this many unlinked items, resolving them one at a time via each
// row's edit dialog is fine; above it, the batch ResolveMappingsDialog is
// offered instead so the user isn't clicking into the same dialog N times.
const BATCH_RESOLVE_THRESHOLD = 3;

// How long a row the smart add line just added stays highlighted — long
// enough to spot where it landed, short enough to be gone by the next add.
const ADDED_HIGHLIGHT_MS = 2000;

type ShoppingListItemRow = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  purchased: boolean;
  addedAutomatically: boolean;
  inventoryItemId: string | null;
  // The linked InventoryItem's category (AUTO-3, [id]/page.tsx's query),
  // null when there's no link yet. Drives shopping mode's grouping below,
  // and each editable row's CategoryChip (AUTO-2b) for correcting it.
  category: string | null;
  // AUTO-4: defaulted from the linked InventoryItem's lastKnownPrice at
  // creation (per-unit, unmultiplied by quantity — see the create paths in
  // actions.ts), then only ever changed by an explicit correction via
  // PriceTag below or an actual receipt price. null means no price is known
  // yet — the row shows nothing rather than "≈ 0".
  estimatedPrice: number | null;
  // GAP-5: optional free-text hint, set from ShoppingItemFormDialog's edit
  // mode. null when there isn't one (never "").
  note: string | null;
  // The linked InventoryItem's barcode (AUTO-6), null without a link or a
  // stored code. Only ReceiptScanDialog reads it, to match a receipt line
  // that prints an EAN exactly (AUTO-11).
  barcode: string | null;
  // The put-away flow's state (see ShoppingListItem.putAwayAt): a ticked
  // row with no putAwayAt is still on its way home and waits in the
  // PutAwayDialog; priceRecordedAt says a receipt already priced it.
  putAwayAt: Date | null;
  priceRecordedAt: Date | null;
  // The linked InventoryItem's current location, the put-away dialog's
  // "stays where it is" placeholder.
  location: string | null;
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
  smartAddCandidates,
  categories,
  units,
  dict,
  autoAddDict,
  barcodeDict,
  exportLabel,
  locale,
  currencyCode,
  storeOrder,
  repurchaseSuggestions,
  defersToPutAway = false,
  locations = [],
  aliases = [],
}: {
  list: ShoppingListData;
  inventoryItems: InventoryItemOption[];
  smartAddCandidates: SmartAddCandidate[];
  categories: string[];
  units: string[];
  dict: ShoppingListDict;
  /** AUTO-8: un-checking a row can drop its item back into low stock and
   * onto "Next shop" — see showAutoAddedToast. */
  autoAddDict: Dictionary["inventory"]["autoAdd"];
  barcodeDict: Dictionary["barcodeScanner"];
  exportLabel: string;
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
  /** AUTO-9: the household's learned and hand-arranged store order. */
  storeOrder: StoreOrder;
  /** AUTO-10: the "You usually buy this about now" chips, rendered by the
   * page (RepurchaseSuggestions) and shown under the smart add line. */
  repurchaseSuggestions?: ReactNode;
  /** The household ticks "into the cart" and puts away later
   * (inventorySyncMode ON_PUT_AWAY) — a receipt applied here then offers the
   * put-away dialog straight after. */
  defersToPutAway?: boolean;
  /** The household's inventory locations, for the put-away dialog. */
  locations?: string[];
  /** MATCH-5: the household's learned item names, so a receipt line or an
   * unlinked row's suggestion links the way the household taught it. */
  aliases?: ItemAliasLike[];
}) {
  const [isPending, startTransition] = useTransition();
  // UX-33: ticks and deletes show (and move their row) at tap time; see
  // local-row-changes.ts. Everything below lays the list out from `items`,
  // the server's rows with this device's unsaved changes applied, so the
  // "Put away" button, the totals and the cleared state follow the tap too.
  // Saves run in their own transition so a pending one never greys the
  // list (UX-14).
  const local = useLocalRowChanges();
  const items = applyLocalRowChanges(list.items, local.changes, (item, purchased) =>
    withLocalTick(item, purchased, defersToPutAway, new Date()),
  );
  const [, startSaveTransition] = useTransition();
  const togglePurchased = (item: ShoppingListItemRow) => {
    const settle = local.markDone(item.id, !item.purchased);
    startSaveTransition(async () => {
      const result = await settleOptimisticAction(() => togglePurchasedAction(item.id), dict.saveFailedToast);
      settle();
      if (result) showAutoAddedToast(result.autoAdded, autoAddDict);
    });
  };
  // Called from the row's confirm dialog, which waits on it and toasts an
  // error; the row has already gone by then and comes back if it failed.
  const deleteItem = async (item: ShoppingListItemRow) => {
    const settle = local.markDeleted(item.id);
    const result = await deleteShoppingListItemAction(item.id);
    settle();
    return result;
  };
  const listRef = useFlipList<HTMLDivElement>();
  // Same formatter as the budget page's amounts (SafeToSpend,
  // TransactionList, …): locale-aware two decimals, with the household's
  // currency symbol once one is set (GAP-13) and none before that.
  const numberFormat = createMoneyFormat(locale, currencyCode);

  const pendingItems = items.filter((item) => !item.purchased);
  const purchasedItems = items.filter((item) => item.purchased);
  // Ticked but not yet in inventory — the put-away dialog's rows. Offered on
  // a completed list too (finishing the trip is exactly when there's
  // something to unpack), never an archived one.
  const awaitingPutAway = list.status === "ARCHIVED" ? [] : items.filter(isAwaitingPutAway);
  // Rows a receipt line may still match: everything unticked, plus rows
  // ticked in the store that no receipt has priced and that haven't been put
  // away (see awaitsReceiptPrice).
  const receiptMatchable = items.filter(awaitsReceiptPrice);
  const isActive = list.status === "ACTIVE";
  const statusLabel = list.status === "COMPLETED" ? dict.statusCompleted : dict.statusArchived;
  const unresolvedItems = items.filter((item) => item.inventoryItemId === null);
  const pendingGroups = groupPendingItemsByCategory(pendingItems, dict.otherCategory, storeOrder);
  // AUTO-9: "Reorder sections" offers every section this list has, pending
  // or already ticked off (you might arrange the store before the next trip
  // with everything ticked), in the order shopping mode walks them. "Other"
  // is left out — it has no aisle and always sorts last. Needs two to be
  // worth offering at all.
  const reorderSections = groupPendingItemsByCategory(items, dict.otherCategory, storeOrder).flatMap(
    (group) => (group.key === null ? [] : [{ key: group.key, label: group.label }]),
  );
  const hasManualOrder = storeOrder.manual.length > 0;
  // AUTO-4: "what's left to buy is roughly going to cost" — see
  // sumEstimatedPendingTotal's own doc comment for why this is pending-only
  // and per-unit/unmultiplied.
  const estimatedTotal = sumEstimatedPendingTotal(pendingItems);

  const showResolveMappings = isActive && unresolvedItems.length >= BATCH_RESOLVE_THRESHOLD;
  const resolveMappingsLabel = format(plural(unresolvedItems.length, dict.resolveMappings.triggerButton), {
    count: unresolvedItems.length,
  });

  // One handle per dialog the ⋯ menu opens (AUTO-5) — created once per
  // mount, see createDialogHandle for why the dialogs can't sit inside the
  // menu itself.
  const [dialogs] = useState(() => ({
    addItem: createDialogHandle(),
    importList: createDialogHandle(),
    share: createDialogHandle(),
    resolveMappings: createDialogHandle(),
    completeList: createDialogHandle(),
    deleteList: createDialogHandle(),
    reorderSections: createDialogHandle(),
    saveTemplate: createDialogHandle(),
  }));

  // null = closed; "finish" = opened from "Done shopping"/"Complete list"
  // while rows are still waiting, so confirming also completes the list.
  const [putAwayMode, setPutAwayMode] = useState<"putAway" | "finish" | null>(null);

  // The put-away reminder (push and bell) links here with `?putAway=1`.
  // Watched as it changes, not just read on mount: tapping the bell while
  // this list is already open is a client-side navigation that only
  // changes the search params. Adjust-state-during-render, like the
  // cleared-state tracking below, so it opens in the same render. Closing
  // the dialog strips the param again, so the next tap is a change too.
  const router = useRouter();
  const pathname = usePathname();
  const putAwayParam = useSearchParams().get("putAway");
  const [seenPutAwayParam, setSeenPutAwayParam] = useState<string | null>(null);
  if (putAwayParam !== seenPutAwayParam) {
    setSeenPutAwayParam(putAwayParam);
    if (putAwayParam === "1" && awaitingPutAway.length > 0) setPutAwayMode("putAway");
  }
  const closePutAway = () => {
    setPutAwayMode(null);
    if (putAwayParam !== null) router.replace(pathname, { scroll: false });
  };

  const addLowStock = () =>
    startTransition(async () => {
      const result = await generateFromLowStockAction(list.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const added = result.added ?? 0;
      if (added > 0) {
        toast.success(format(plural(added, dict.addLowStockAddedToast), { count: added }));
      } else {
        toast.info(dict.addLowStockNoneToast);
      }
    });

  // Shared by "Done shopping" (no confirm — every item is already checked
  // off, so there's nothing to lose) and the menu's confirm-gated "Complete
  // list" (items still pending). Both go through finishTrip below first, so
  // ticked rows that haven't been put away are offered for put-away before
  // the list closes rather than finishing around them unnoticed. Either way
  // the toast carries an "Undo" (BACKLOG.md's "undo over confirm") that
  // reopens the list and removes exactly the Groceries expense this
  // completion logged, if any.
  const completeList = () =>
    startTransition(async () => {
      const result = await completeShoppingListAction(list.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const transactionId = result.transactionId;
      toast.success(dict.completedToast, {
        description: result.expenseLoggedMessage,
        action: {
          label: dict.undo,
          onClick: () =>
            startTransition(async () => {
              const undo = await uncompleteShoppingListAction(list.id, transactionId);
              if (undo.error) toast.error(undo.error);
            }),
        },
      });
      if (result.unresolvedNotice) toast.info(result.unresolvedNotice);
    });

  const finishTrip = (confirmFirst: boolean) => {
    if (awaitingPutAway.length > 0) setPutAwayMode("finish");
    else if (confirmFirst) dialogs.completeList.open(null);
    else completeList();
  };

  // AUTO-9: back to the learned order, undoable rather than confirm-gated
  // (the dropped order comes back from the action for exactly that).
  const resetStoreOrder = () =>
    startTransition(async () => {
      const result = await resetCategoryOrderAction();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const previous = result.previous ?? [];
      toast.success(dict.reorderSections.resetToast, {
        action:
          previous.length > 0
            ? {
                label: dict.undo,
                onClick: () =>
                  startTransition(async () => {
                    const undo = await saveCategoryOrderAction(previous);
                    if (undo.error) toast.error(undo.error);
                  }),
              }
            : undefined,
      });
    });

  // AUTO-3: keep the screen on while there's an ACTIVE list open on a phone.
  useScreenWakeLock(isActive);

  // "Cleared" covers two cases: every item got checked off (purchasedItems
  // non-empty), or the list was emptied out entirely after having had items
  // this session (hadItems distinguishes that from a list that's simply
  // never had anything added to it, which gets the plain empty state).
  const [hadItems, setHadItems] = useState(items.length > 0);
  if (items.length > 0 && !hadItems) setHadItems(true);
  const isCleared =
    pendingItems.length === 0 && (purchasedItems.length > 0 || (items.length === 0 && hadItems));

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

  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(new Set());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);
  const highlightAdded = (ids: string[]) => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightedIds(new Set(ids));
    highlightTimer.current = setTimeout(() => setHighlightedIds(new Set()), ADDED_HIGHLIGHT_MS);
  };

  return (
    // GAP-24: on paper every child of this column is hidden except
    // PrintableList, which is the only thing that prints (and the only
    // thing that doesn't show on screen). Hiding by selector here rather
    // than tagging each child keeps the interactive tree below untouched.
    // Dialogs and the ⋯ menu render into portals outside this div, so they
    // hide themselves (the menu's popup can still be fading out when the
    // print dialog snapshots the page).
    <div className="flex flex-col gap-6 print:block print:[&>:not([data-print-list])]:hidden">
      <PrintableList name={list.name} groups={pendingGroups} dict={dict} />
      <Link
        href="/dashboard/shopping-list"
        className="touch-target inline-flex w-fit items-center gap-1.5 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {dict.backToAll}
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MorphTitle kind="shopping-list" id={list.id}>
              <h1 className="font-heading text-2xl font-semibold tracking-tight">{list.name}</h1>
            </MorphTitle>
            {!isActive && <Badge variant="secondary">{statusLabel}</Badge>}
          </div>
          {/* AUTO-4: hidden until at least one pending item has a price —
              nothing to estimate yet otherwise. */}
          {estimatedTotal > 0 && (
            <p className="text-sm text-muted-foreground">
              {format(dict.estimatedTotal, { amount: numberFormat.format(estimatedTotal) })}
            </p>
          )}
        </div>
        {/* AUTO-5: only what's used on every trip stays visible — "Scan
            receipt" here and the smart add line below. Everything else
            lives in the ⋯ menu; the dialogs those items open are rendered
            outside it (see the handles above) because the menu's popup
            unmounts as it closes. */}
        <div className="flex flex-wrap items-center gap-2">
          {awaitingPutAway.length > 0 && (
            <Button variant="outline" disabled={isPending} onClick={() => setPutAwayMode("putAway")}>
              <PackageCheck className="size-4" />
              {format(dict.putAway.button, { count: awaitingPutAway.length })}
            </Button>
          )}
          {isActive && (
            <ReceiptScanDialog
              listId={list.id}
              pendingItems={receiptMatchable.map((item) => ({
                id: item.id,
                name: item.name,
                barcode: item.barcode,
                inventoryItemId: item.inventoryItemId,
              }))}
              inventoryItems={inventoryItems}
              aliases={aliases}
              categories={categories}
              units={units}
              dict={dict.receiptScan}
              // In put-away mode the receipt only priced the rows; the
              // stock still has to be confirmed, and now is when the bags
              // are on the counter.
              onApplied={defersToPutAway ? () => setPutAwayMode("putAway") : undefined}
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="icon" disabled={isPending} aria-label={dict.moreActions}>
                  <Ellipsis className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-auto min-w-52 print:hidden">
              {isActive && (
                <>
                  <DropdownMenuItem onClick={() => dialogs.addItem.open(null)}>
                    <Plus />
                    {dict.addItem}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => dialogs.importList.open(null)}>
                    <ClipboardPaste />
                    {dict.importList.triggerLabel}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={addLowStock}>
                    <PackagePlus />
                    {dict.addLowStock}
                  </DropdownMenuItem>
                  {showResolveMappings && (
                    <DropdownMenuItem onClick={() => dialogs.resolveMappings.open(null)}>
                      <Link2 />
                      {resolveMappingsLabel}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => dialogs.share.open(null)}>
                    <Share2 />
                    {dict.shareLink.button}
                  </DropdownMenuItem>
                  {reorderSections.length >= 2 && (
                    <DropdownMenuItem onClick={() => dialogs.reorderSections.open(null)}>
                      <ArrowUpDown />
                      {dict.reorderSections.menuItem}
                    </DropdownMenuItem>
                  )}
                  {hasManualOrder && (
                    <DropdownMenuItem onClick={resetStoreOrder}>
                      <RotateCcw />
                      {dict.reorderSections.resetMenuItem}
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {/* GAP-4: offered on any status — saving a finished trip as a
                  template is the common case. */}
              {items.length > 0 && (
                <DropdownMenuItem onClick={() => dialogs.saveTemplate.open(null)}>
                  <ScrollText />
                  {dict.templates.menuItem}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem render={<Link href={`/dashboard/shopping-list/${list.id}/export`} prefetch={false} />}>
                <Download />
                {exportLabel}
              </DropdownMenuItem>
              {/* GAP-24: the browser's own print dialog, fed by the
                  print-only PrintableList below — no route, no PDF. */}
              <DropdownMenuItem onClick={() => window.print()}>
                <Printer />
                {dict.print}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isActive && items.length > 0 && (
                <DropdownMenuItem onClick={() => finishTrip(true)}>
                  <CheckCheck />
                  {dict.completeList}
                </DropdownMenuItem>
              )}
              {list.status === "ARCHIVED" ? (
                <DropdownMenuItem
                  onClick={() =>
                    startTransition(async () => {
                      const result = await unarchiveShoppingListAction(list.id);
                      if (result.error) toast.error(result.error);
                    })
                  }
                >
                  <ArchiveRestore />
                  {dict.unarchive}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() =>
                    startTransition(async () => {
                      const result = await archiveShoppingListAction(list.id);
                      if (result.error) toast.error(result.error);
                    })
                  }
                >
                  <Archive />
                  {dict.archive}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onClick={() => dialogs.deleteList.open(null)}>
                <Trash2 />
                {dict.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {list.status !== "ARCHIVED" && (
        <PutAwayDialog
          open={putAwayMode !== null}
          onOpenChange={(next) => {
            if (!next) closePutAway();
          }}
          listId={list.id}
          items={awaitingPutAway.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            inventoryItemId: item.inventoryItemId,
            estimatedPrice: item.estimatedPrice,
            location: item.location,
          }))}
          finishing={putAwayMode === "finish" && isActive}
          // Finishing from the dialog still respects the "complete with items
          // pending" confirmation whenever unticked rows remain — including
          // ones the dialog itself just sent back as "didn't get it".
          onFinish={(newlyPending) =>
            pendingItems.length + newlyPending > 0 ? dialogs.completeList.open(null) : completeList()
          }
          numberFormat={numberFormat}
          locations={locations}
          dict={dict}
          autoAddDict={autoAddDict}
        />
      )}

      {items.length > 0 && (
        <SaveTemplateDialog listId={list.id} listName={list.name} dict={dict.templates} handle={dialogs.saveTemplate} />
      )}

      {isActive && (
        <>
          <ShoppingItemFormDialog
            mode="create"
            listId={list.id}
            inventoryItems={inventoryItems}
            units={units}
            dict={dict}
            barcodeDict={barcodeDict}
            handle={dialogs.addItem}
          />
          <ImportListDialog listId={list.id} dict={dict.importList} handle={dialogs.importList} />
          <ShareListButton shoppingListId={list.id} dict={dict.shareLink} handle={dialogs.share} />
          <ReorderSectionsDialog
            sections={reorderSections}
            dict={dict.reorderSections}
            handle={dialogs.reorderSections}
          />
          {showResolveMappings && (
            <ResolveMappingsDialog
              items={unresolvedItems.map((item) => ({ id: item.id, name: item.name }))}
              inventoryItems={inventoryItems}
              aliases={aliases}
              categories={categories}
              dict={dict.resolveMappings}
              triggerLabel={resolveMappingsLabel}
              handle={dialogs.resolveMappings}
            />
          )}
          <ConfirmDialog
            handle={dialogs.completeList}
            title={dict.confirmCompleteList.title}
            description={dict.confirmCompleteList.description}
            cancelLabel={dict.confirmCompleteList.cancel}
            confirmLabel={dict.confirmCompleteList.confirm}
            pendingLabel={dict.confirmCompleteList.confirming}
            variant="default"
            onConfirm={completeList}
          />
        </>
      )}
      <ConfirmDialog
        handle={dialogs.deleteList}
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

      {isActive && (
        <SmartAddBar
          listId={list.id}
          candidates={smartAddCandidates}
          pendingInventoryItemIds={pendingItems.flatMap((item) => (item.inventoryItemId ? [item.inventoryItemId] : []))}
          dict={dict.smartAdd}
          barcodeDict={barcodeDict}
          locale={locale}
          onAdded={highlightAdded}
        />
      )}
      {isActive && repurchaseSuggestions}

      <div ref={listRef} className="relative flex flex-col gap-2">
        {showCleared ? (
          <ClearedState
            dict={dict}
            onDismiss={() => setClearedDismissed(true)}
            // Only once something was actually bought — a list that was
            // simply emptied out has no trip to finish.
            onDone={isActive && purchasedItems.length > 0 ? () => finishTrip(false) : undefined}
            isPending={isPending}
          />
        ) : pendingItems.length === 0 && purchasedItems.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {isActive ? dict.emptyListActive : dict.emptyListOther}
          </p>
        ) : (
          <>
            {/* Shopping mode (AUTO-3): pending items grouped by the linked
                inventory item's category, in the household's store order
                (AUTO-9: learned from check-offs, or arranged by hand) —
                see groupPendingItemsByCategory. Purchased items below stay
                a single flat "Purchased" section, unchanged. */}
            {pendingGroups.map((group) => (
              <Fragment key={group.key ?? ""}>
                <p data-flip-key={`label:${group.key ?? ""}`} className="text-xs font-medium uppercase text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <ShoppingRow
                    key={item.id}
                    item={item}
                    highlighted={highlightedIds.has(item.id)}
                    editable={isActive}
                    groupedByCategory
                    isPending={isPending}
                    startTransition={startTransition}
                    onTogglePurchased={togglePurchased}
                    onDelete={deleteItem}
                    inventoryItems={inventoryItems}
                    categories={categories}
                    units={units}
                    dict={dict}
                    numberFormat={numberFormat}
                  />
                ))}
              </Fragment>
            ))}
            {purchasedItems.length > 0 && (
              <p data-flip-key="label:purchased" className="mt-4 text-xs font-medium uppercase text-muted-foreground">
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
                onTogglePurchased={togglePurchased}
                onDelete={deleteItem}
                inventoryItems={inventoryItems}
                categories={categories}
                units={units}
                dict={dict}
                numberFormat={numberFormat}
                awaitingPutAway={list.status !== "ARCHIVED" && isAwaitingPutAway(item)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * GAP-24's paper copy: what's still left to buy, grouped under the same
 * category headers as shopping mode (AUTO-3's groupPendingItemsByCategory,
 * so aisle order matches the screen), in big black-on-white single-column
 * text for a fridge door or a trolley handle. `hidden print:block`: it
 * never shows on screen, and the column above hides everything else on
 * paper. Purchased items, prices, badges and the estimated total are left
 * out on purpose. They're for the phone, and on paper they'd just be noise
 * between the things you still need. Each row gets an empty box to tick
 * with a pen, and break-inside-avoid keeps a category header from being
 * stranded at the bottom of a page without its items.
 */
function PrintableList({
  name,
  groups,
  dict,
}: {
  name: string;
  groups: ShoppingModeGroup<ShoppingListItemRow>[];
  dict: ShoppingListDict;
}) {
  const unitLabel = useUnitLabel();
  return (
    <section data-print-list className="hidden bg-white text-black print:block">
      <h1 className="mb-6 border-b-2 border-black pb-2 font-heading text-4xl font-bold">{name}</h1>
      {groups.length === 0 ? (
        <p className="text-2xl">{dict.printEmpty}</p>
      ) : (
        groups.map((group) => (
          <div key={group.key ?? ""} className="mb-6 break-inside-avoid">
            <h2 className="mb-2 text-lg font-bold uppercase tracking-wide">{group.label}</h2>
            <ul className="flex flex-col gap-2">
              {group.items.map((item) => (
                <li key={item.id} className="flex items-baseline gap-3 text-2xl leading-snug">
                  <span aria-hidden className="inline-block size-5 shrink-0 translate-y-0.5 border-2 border-black" />
                  <span>
                    {item.name} × {item.quantity} {unitLabel(item.unit)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function ClearedState({
  dict,
  onDismiss,
  onDone,
  isPending,
}: {
  dict: ShoppingListDict;
  onDismiss: () => void;
  /** AUTO-5: completes the list in one tap, with Undo on the toast. */
  onDone?: () => void;
  isPending: boolean;
}) {
  return (
    <div className="relative flex flex-col items-center gap-1.5 rounded-md border border-dashed p-8 text-center">
      <CheckCheck className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium">{dict.clearedTitle}</p>
      <p className="text-sm text-muted-foreground">{dict.clearedDescription}</p>
      {onDone && (
        <Button className="mt-3" disabled={isPending} onClick={onDone}>
          {dict.doneShopping}
        </Button>
      )}
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
  highlighted = false,
  editable,
  isPending,
  startTransition,
  onTogglePurchased,
  onDelete,
  inventoryItems,
  categories,
  units,
  dict,
  numberFormat,
  awaitingPutAway = false,
  groupedByCategory = false,
}: {
  item: ShoppingListItemRow;
  /** Ticked but not in inventory yet — gets a small "Not put away" tag. */
  awaitingPutAway?: boolean;
  highlighted?: boolean;
  /** The row sits under its category's group header (the pending section),
   * so its own category chip would only repeat that header (UX-22). */
  groupedByCategory?: boolean;
  editable: boolean;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
  onTogglePurchased: (item: ShoppingListItemRow) => void;
  onDelete: (item: ShoppingListItemRow) => Promise<{ error?: string }>;
  inventoryItems: InventoryItemOption[];
  categories: string[];
  units: string[];
  dict: ShoppingListDict;
  numberFormat: Intl.NumberFormat;
}) {
  const unitLabel = useUnitLabel();
  const needsMapping = item.inventoryItemId === null;

  // A just-added row scrolls into view if the list is long enough to have
  // hidden it ("nearest" leaves it alone if it's already on screen). New
  // rows always land at the bottom of the pending section, so the sticky add
  // line above never covers them; the phone BottomNav below is cleared by
  // main's scroll-padding in the dashboard layout.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  // UX-14 and UX-33: the tick shows the moment it's tapped and the row
  // moves to its section at once. The list owns the save
  // (ShoppingListClient's togglePurchased), so on weak in-store signal you
  // can tick the next three items while the first is still on its way, and
  // a failed save moves the row back with a toast. Each tap flips from what
  // the row shows now, so a quick re-tap unticks it again, matching the two
  // toggles it sends.
  const purchased = item.purchased;
  const handleTogglePurchased = () => onTogglePurchased(item);

  return (
    <div
      ref={rowRef}
      data-flip-key={item.id}
      className={cn(
        "flex flex-col gap-1 rounded-md border transition-colors duration-700",
        // AUTO-3: a bigger touch target while the list is ACTIVE (shopping
        // mode) — rows are tapped one-handed, phone in the other hand, so
        // this is when it matters most; a read-only list stays compact.
        editable ? "px-3 py-3" : "px-3 py-2",
        highlighted && "border-primary/50 bg-primary/10",
      )}
    >
      {/* Below sm the row stacks: the name gets the full width on its own
          line and the controls drop to a second line, indented under it.
          On one line, the shrink-0 controls (category chip, price — wider
          since GAP-13 added a currency symbol — edit, delete) left a phone
          only a few pixels of truncated name, the one part of the row you
          actually need to read in the aisle. */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <label
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3",
            // Stretches the label to the row's full height so tapping
            // anywhere on the row (not just the checkbox glyph) toggles
            // purchased — the label/input pairing (Checkbox is a native
            // <input type="checkbox">) already gives this keyboard and
            // screen-reader semantics for free, no extra handler needed.
            editable && "cursor-pointer self-stretch max-sm:min-h-11 pointer-coarse:min-h-11",
          )}
        >
          <Checkbox
            checked={purchased}
            disabled={isPending || !editable}
            className={editable ? "size-5" : undefined}
            onChange={handleTogglePurchased}
          />
          <span
            className={`min-w-0 flex-1 break-words sm:truncate ${purchased ? "text-muted-foreground line-through" : ""}`}
            title={`${item.name} × ${item.quantity} ${unitLabel(item.unit)}`}
          >
            {item.name} × {item.quantity} {unitLabel(item.unit)}
          </span>
          {item.addedAutomatically && (
            <Badge variant="secondary" className="shrink-0">
              {dict.lowStockBadge}
            </Badge>
          )}
          {awaitingPutAway && (
            <Badge variant="outline" className="shrink-0">
              {dict.putAway.awaitingBadge}
            </Badge>
          )}
          {!editable && needsMapping && (
            <Badge variant="outline" className="shrink-0 border-dashed">
              {dict.needsMappingBadge}
            </Badge>
          )}
        </label>
        {/* Outside the label on purpose (AUTO-4) — anything inside it would
            also toggle the checkbox on tap, since Checkbox is a native
            <input> the label is already wired to. Rendered even on a
            non-editable (view-only) row, just without the tap-to-correct
            affordance, since the estimate itself is still worth showing. */}
        <div className={cn("flex shrink-0 flex-wrap items-center gap-1 max-sm:gap-2 pointer-coarse:gap-2 empty:hidden sm:pl-0", editable ? "pl-8" : "pl-7")}>
          {/* AUTO-2b: the in-place fix for a wrong auto-category guess.
              Only on an editable, linked row — an unlinked one has no
              category yet (the mapping flow picks one), and a read-only
              list already shows each row's category as its group header.
              Rows under a group header skip it for the same reason
              (UX-22), so it shows on the flat Purchased section. */}
          {editable && item.category !== null && !groupedByCategory && (
            <CategoryChip
              itemId={item.id}
              itemName={item.name}
              category={item.category}
              categories={categories}
              disabled={isPending}
              dict={dict.categoryChip}
            />
          )}
          <PriceTag item={item} editable={editable} isPending={isPending} startTransition={startTransition} numberFormat={numberFormat} dict={dict} />
          {editable && (
            <>
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
                // UX-33: the row goes at once; the dialog waits on the save
                // (showing "Deleting…" if it's still there) and toasts an
                // error, and the row comes back.
                onConfirm={() => onDelete(item)}
              />
            </>
          )}
        </div>
      </div>
      {/* GAP-5: the note as a muted second line, indented past the checkbox
          (size-5 + gap-3 on an editable row, size-4 + gap-3 otherwise) so it
          lines up under the item name. Outside the label so tapping it
          doesn't toggle the row, and wrapped rather than truncated — unlike
          the name, the note is the part someone needs to read in the aisle. */}
      {item.note && (
        <p
          className={cn(
            "text-xs break-words whitespace-pre-line text-muted-foreground",
            editable ? "pl-8" : "pl-7",
          )}
        >
          {item.note}
        </p>
      )}
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

/**
 * The row's "≈ 24 kr" (AUTO-4) — muted, tappable text that swaps for a
 * small inline input on tap, following the same "tap a value to correct it
 * in place" idea as, say, an inventory quantity stepper, just with no prior
 * example of an inline-edited text field in this codebase to match exactly.
 * A save round-trips through updateShoppingListItemPriceAction; until it
 * resolves the input just sits there disabled rather than optimistically
 * updating, since a bad round trip here would otherwise show a corrected
 * price that didn't actually save.
 *
 * Read-only (not editable) rows still render the plain "≈ price" text when
 * one is set — the estimate is informational even once a list is completed
 * or archived — just without the tap affordance, matching every other
 * per-row edit control's editable-only gating.
 */
function PriceTag({
  item,
  editable,
  isPending,
  startTransition,
  numberFormat,
  dict,
}: {
  item: ShoppingListItemRow;
  editable: boolean;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
  numberFormat: Intl.NumberFormat;
  dict: ShoppingListDict;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => (item.estimatedPrice != null ? String(item.estimatedPrice) : ""));

  if (!editable) {
    return item.estimatedPrice != null ? (
      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
        ≈ {numberFormat.format(item.estimatedPrice)}
      </span>
    ) : null;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="touch-target shrink-0 justify-center rounded px-1 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline tabular-nums"
        disabled={isPending}
        onClick={() => {
          setDraft(item.estimatedPrice != null ? String(item.estimatedPrice) : "");
          setEditing(true);
        }}
        aria-label={
          item.estimatedPrice != null
            ? format(dict.editPriceAriaLabel, { name: item.name })
            : format(dict.addPriceAriaLabel, { name: item.name })
        }
      >
        {item.estimatedPrice != null ? `≈ ${numberFormat.format(item.estimatedPrice)}` : dict.addPriceLabel}
      </button>
    );
  }

  function save() {
    const price = Number(draft.replace(",", "."));
    if (draft.trim() === "" || !Number.isFinite(price) || price < 0) {
      toast.error(dict.priceInvalid);
      return;
    }
    startTransition(async () => {
      const result = await updateShoppingListItemPriceAction(item.id, price);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setEditing(false);
    });
  }

  return (
    <form
      className="flex shrink-0 items-center gap-1 max-sm:gap-2 pointer-coarse:gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        autoFocus
        value={draft}
        disabled={isPending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-24 px-2"
        aria-label={format(dict.priceInputAriaLabel, { name: item.name })}
      />
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        className="size-7"
        disabled={isPending}
        aria-label={dict.savePriceAriaLabel}
      >
        <Check className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 text-muted-foreground"
        disabled={isPending}
        onClick={() => setEditing(false)}
        aria-label={dict.cancelPriceAriaLabel}
      >
        <X className="size-3.5" />
      </Button>
    </form>
  );
}
