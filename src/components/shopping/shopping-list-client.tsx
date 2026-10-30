"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SHARE_TEXT_PARAM } from "@/lib/share-target";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  CheckCheck,
  ChevronDown,
  CloudOff,
  ClipboardPaste,
  Copy,
  Download,
  Ellipsis,
  Link2,
  PackageCheck,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  ScrollText,
  Share2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createDialogHandle } from "@/components/ui/dialog";
import { LazyDialog, openLazyDialog } from "@/components/ui/lazy-dialog";
import { LazyReceiptScan } from "@/components/shopping/lazy-receipt-scan";
import {
  loadImportListDialog,
  loadPartialPriceDialog,
  loadPutAwayDialog,
  loadRenameListDialog,
  loadReorderSectionsDialog,
  loadResolveMappingsDialog,
  loadSaveTemplateDialog,
  loadShoppingItemFormDialog,
} from "@/components/shopping/lazy-dialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShareListButton } from "@/components/shopping/share-list-button";
import { SmartAddBar } from "@/components/shopping/smart-add-bar";
import { NextUpDock } from "@/components/shopping/shopping-mode";
import {
  completeShoppingListAction,
  deleteShoppingListAction,
  generateFromLowStockAction,
  unarchiveShoppingListAction,
  uncompleteShoppingListAction,
} from "@/app/dashboard/shopping-list/list-actions";
import { putAwayItemsAction } from "@/app/dashboard/shopping-list/purchase-actions";
import {
  resetCategoryOrderAction,
  saveCategoryOrderAction,
} from "@/app/dashboard/shopping-list/store-order-actions";
import { format, plural } from "@/lib/i18n/format";
import { tripDurationMinutes } from "@/lib/shopping/trip-summary";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import { archiveListWithUndo } from "@/components/shopping/archive-list";
import { cn } from "@/lib/utils";
import type { SmartAddCandidate } from "@/lib/shopping/smart-add-suggestions";
import { groupPendingItemsByCategory } from "@/lib/shopping/shopping-mode-grouping";
import type { StoreOrder } from "@/lib/shopping/store-order";
import { countPriced, sumEstimatedPendingTotal } from "@/lib/shopping/estimated-total";
import { nextUp, shoppingProgress } from "@/lib/shopping/shopping-progress";
import { useScreenWakeLock } from "@/lib/shopping/use-screen-wake-lock";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";
import { awaitsReceiptPrice, isAwaitingPutAway } from "@/lib/shopping/put-away-calc";
import type { ItemAliasLike } from "@/lib/item-alias";
import { useUnitLabel } from "@/components/units-provider";
import { PageTitle } from "@/components/dashboard/page-title";
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";
import { PrintableList } from "@/components/shopping/printable-list";
import { ClearedState, CompletedActions } from "@/components/shopping/cleared-state";
import { ShoppingRow } from "@/components/shopping/shopping-row";
import {
  useAddedHighlight,
  useCarryOver,
  useClearedState,
  useListTextShare,
  usePutAwayDialog,
  useShoppingTicks,
} from "@/components/shopping/use-shopping-list-state";
import type {
  InventoryItemOption,
  ShoppingListData,
  ShoppingListDict,
} from "@/components/shopping/shopping-list-types";

// Below this many unlinked items, resolving them one at a time via each
// row's edit dialog is fine; above it, the batch ResolveMappingsDialog is
// offered instead so the user isn't clicking into the same dialog N times.
const BATCH_RESOLVE_THRESHOLD = 3;

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
  carryOverListName = "",
  nextListId = null,
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
  /** UX-80: the list the unbought rows move to on completion. */
  carryOverListName?: string;
  /** UX-81: the household's active default list when it isn't this one, which
   * "Start next list" opens; null makes that button create a fresh list. */
  nextListId?: string | null;
  /** MATCH-5: the household's learned item names, so a receipt line or an
   * unlinked row's suggestion links the way the household taught it. */
  aliases?: ItemAliasLike[];
}) {
  const [isPending, startTransition] = useTransition();
  // Same formatter as the budget page's amounts (SafeToSpend,
  // TransactionList, …): locale-aware two decimals, with the household's
  // currency symbol once one is set (GAP-13) and none before that.
  const numberFormat = createMoneyFormat(locale, currencyCode);
  const {
    items,
    pendingItems,
    purchasedItems,
    shownPendingItems,
    leaving,
    celebrate,
    setCelebrate,
    queuedTicks,
    hasQueuedTicks,
    isTicking,
    toggleItem,
    deleteItem,
    listRef,
  } = useShoppingTicks({ list, defersToPutAway, dict, autoAddDict });

  const progress = shoppingProgress(items);
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
  const pendingGroups = groupPendingItemsByCategory(pendingItems, dict.otherCategory, storeOrder, locale);
  const shownPendingGroups = groupPendingItemsByCategory(shownPendingItems, dict.otherCategory, storeOrder, locale);
  const unitLabel = useUnitLabel();
  const { canShareText, copyListText, shareListText } = useListTextShare({
    listName: list.name,
    groups: pendingGroups,
    locale,
    unitLabel,
    dict,
  });
  // UX-37: the aisle the thumb-zone dock offers (see NextUpDock).
  const nextUpItems = nextUp(pendingGroups);
  // "In the cart" starts collapsed on an ACTIVE list — mid-shop it's what
  // you no longer need to see — and opens with its button.
  const [cartOpen, setCartOpen] = useState(false);
  // AUTO-9: "Reorder sections" offers every section this list has, pending
  // or already ticked off (you might arrange the store before the next trip
  // with everything ticked), in the order shopping mode walks them. "Other"
  // is left out — it has no aisle and always sorts last. Needs two to be
  // worth offering at all.
  const reorderSections = groupPendingItemsByCategory(items, dict.otherCategory, storeOrder, locale).flatMap(
    (group) => (group.key === null ? [] : [{ key: group.key, label: group.label }]),
  );
  const hasManualOrder = storeOrder.manual.length > 0;
  // AUTO-4: "what's left to buy is roughly going to cost" — see
  // sumEstimatedPendingTotal's own doc comment for why this is pending-only
  // and per-unit/unmultiplied.
  const estimatedTotal = sumEstimatedPendingTotal(pendingItems);
  // UX-87: "1 of 14 priced" next to the amount, so a sum over a few priced
  // rows doesn't pass for the cost of the whole trip.
  const pendingPriced = countPriced(pendingItems);
  // Same question for what's already in the cart, asked when completing: the
  // Groceries expense is the sum of the priced bought rows, so when some
  // bought rows have no price that sum undercounts the trip.
  const boughtPriced = countPriced(purchasedItems);
  const boughtPricedTotal = sumEstimatedPendingTotal(purchasedItems);
  const hasPartialPrices = boughtPriced.priced > 0 && boughtPriced.priced < boughtPriced.total;

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
    partialPrice: createDialogHandle(),
    deleteList: createDialogHandle(),
    reorderSections: createDialogHandle(),
    saveTemplate: createDialogHandle(),
    renameList: createDialogHandle(),
  }));

  // GAP-67: a list shared to Squirrel from another app arrives as
  // `?pasteText=…` (src/app/dashboard/share, via the shopping-list page's
  // redirect to the active list). Open "Paste a list" with the text filled
  // in, then strip the param so a reload doesn't reopen it. Nothing is added
  // until the user parses and confirms. A list that's no longer active has no
  // such dialog, so it just drops the param.
  const router = useRouter();
  const pathname = usePathname();
  const sharedText = useSearchParams().get(SHARE_TEXT_PARAM);
  // Seeded from the URL at mount, so the dialog's first render already has it.
  const [prefillText] = useState(sharedText ?? "");
  useEffect(() => {
    if (!sharedText) return;
    if (isActive) {
      openLazyDialog(dialogs.importList);
    }
    router.replace(pathname, { scroll: false });
  }, [sharedText, isActive, dialogs, pathname, router]);

  const { putAwayMode, setPutAwayMode, closePutAway } = usePutAwayDialog(awaitingPutAway.length);

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
  const runComplete = (amount?: number | null) =>
    startTransition(async () => {
      const result = await completeShoppingListAction(list.id, amount, carryOverRef.current);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const transactionId = result.transactionId;
      const carried = result.carriedOver;
      const movedMessage = carried
        ? format(plural(carried.itemIds.length, dict.carryOver.toast), {
            count: carried.itemIds.length,
            list: carried.listName,
          })
        : undefined;
      toast.success(dict.completedToast, {
        description: [result.expenseLoggedMessage, movedMessage].filter(Boolean).join(" "),
        action: {
          label: dict.undo,
          onClick: () =>
            startTransition(async () => {
              const undo = await uncompleteShoppingListAction(list.id, transactionId, carried?.itemIds);
              if (undo.error) toast.error(undo.error);
            }),
        },
      });
      if (result.unresolvedNotice) toast.info(result.unresolvedNotice);
    });

  // UX-87: with some bought rows unpriced, ask what to log before the list
  // closes; otherwise complete as before.
  const completeList = () => (hasPartialPrices ? openLazyDialog(dialogs.partialPrice) : runComplete());

  // UX-80: whether completing moves the unbought rows to the next list. A
  // ref beside the state because the put-away sheet sets it and completes in
  // the same tick, before a re-render would hand runComplete the new value.
  const { carryOver, carryOverRef, setCarryOver } = useCarryOver();

  const finishTrip = (confirmFirst: boolean) => {
    if (awaitingPutAway.length > 0) setPutAwayMode("finish");
    // The confirm exists because something is still unticked; with nothing
    // pending there's nothing to confirm (the toast's Undo covers a slip).
    else if (confirmFirst && pendingItems.length > 0) {
      setCarryOver(true);
      dialogs.completeList.open(null);
    } else {
      // No checkbox is shown on this path, so the choice can't be the user's:
      // set it explicitly rather than inherit whatever an earlier completion
      // (or its Undo) left in the ref. A row that turns up unticked anyway
      // (added on another device since this page loaded) stays put, as it did
      // before carry-over existed.
      setCarryOver(false);
      completeList();
    }
  };

  // UX-81: "All done"'s one primary. Accepts every default the put-away sheet
  // would open with (the list's quantity, no best-before, the item's own
  // location), then finishes the list when it's still active. Nothing is
  // pending here (the cleared state needs every row ticked), so there's no
  // carry-over to ask about. "Review first" opens the sheet for the rows
  // worth adjusting.
  const putEverythingAway = () =>
    startTransition(async () => {
      const result = await putAwayItemsAction(
        list.id,
        awaitingPutAway.map((item) => ({ itemId: item.id, quantity: item.quantity })),
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const putAway = result.putAway ?? 0;
      if (putAway > 0) toast.success(format(plural(putAway, dict.putAway.doneToast), { count: putAway }));
      showAutoAddedToast(result.autoAdded, autoAddDict);
      if (isActive) {
        setCarryOver(false);
        completeList();
      }
    });

  // UX-81: "15 items · ≈ 240 kr · 18 min". The price part follows the
  // header's rule (rows with a price only) and, like the time, is left out
  // when unknown rather than shown as zero.
  const tripMinutes = tripDurationMinutes(purchasedItems.map((item) => item.checkedOffAt));
  const tripSummary = [
    format(plural(purchasedItems.length, dict.tripSummary.items), { count: purchasedItems.length }),
    boughtPricedTotal > 0 ? format(dict.tripSummary.cost, { amount: numberFormat.format(boughtPricedTotal) }) : null,
    tripMinutes === null ? null : format(dict.tripSummary.minutes, { count: tripMinutes }),
  ]
    .filter(Boolean)
    .join(" · ");

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

  const { isCleared, clearedDismissed, dismissCleared } = useClearedState({
    itemCount: items.length,
    pendingCount: pendingItems.length,
    purchasedCount: purchasedItems.length,
    setCelebrate,
  });
  // A completed list with nothing left to put away has no "All done" to
  // show: its own card (CompletedActions) says the trip is over instead.
  const showCleared = isCleared && !clearedDismissed && (isActive || awaitingPutAway.length > 0);
  const showCompleted = list.status === "COMPLETED" && !showCleared && purchasedItems.length > 0;

  const { highlightedIds, highlightAdded } = useAddedHighlight();

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

      {hasQueuedTicks && (
        <p
          role="status"
          className="inline-flex w-fit items-center gap-2 rounded-full border bg-muted px-3 py-1.5 text-sm text-muted-foreground"
        >
          <CloudOff className="size-4" aria-hidden />
          {format(plural(queuedTicks.length, dict.offlineQueued), { count: queuedTicks.length })}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <PageTitle
              morph={{ kind: "shopping-list", id: list.id }}
              onTap={() => openLazyDialog(dialogs.renameList)}
              tapHint={dict.renameList.titleHint}
            >{list.name}</PageTitle>
            {!isActive && <Badge variant="secondary">{statusLabel}</Badge>}
          </div>
          {/* AUTO-4: hidden until at least one pending item has a price —
              nothing to estimate yet otherwise. */}
          {estimatedTotal > 0 && (
            <p className="text-sm text-muted-foreground">
              {format(dict.estimatedTotal, {
                amount: numberFormat.format(estimatedTotal),
                priced: pendingPriced.priced,
                total: pendingPriced.total,
              })}
            </p>
          )}
        </div>
        {/* AUTO-5: only what's used on every trip stays visible — "Scan
            receipt" here and the smart add line below. Everything else
            lives in the ⋯ menu; the dialogs those items open are rendered
            outside it (see the handles above) because the menu's popup
            unmounts as it closes. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* UX-81: "All done" already offers the put-away as its one
              primary, so the header's twin button steps aside there. */}
          {awaitingPutAway.length > 0 && !showCleared && (
            <Button variant="outline" disabled={isPending} onClick={() => setPutAwayMode("putAway")}>
              <PackageCheck className="size-4" />
              {format(dict.putAway.button, { count: awaitingPutAway.length })}
            </Button>
          )}
          {/* UX-50: a brand-new list has nothing to match a receipt against, so
              the button waits for the first row instead of leading the page
              as a disabled bar above the add line. */}
          {isActive && items.length > 0 && (
            <LazyReceiptScan
              listId={list.id}
              pendingItems={receiptMatchable.map((item) => ({
                id: item.id,
                name: item.name,
                quantity: item.quantity,
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
              {/* UX-85: offered on any status, like Save as template. */}
              <DropdownMenuItem onClick={() => openLazyDialog(dialogs.renameList)}>
                <Pencil />
                {dict.renameList.menuItem}
              </DropdownMenuItem>
              {isActive && (
                <>
                  <DropdownMenuItem onClick={() => openLazyDialog(dialogs.addItem)}>
                    <Plus />
                    {dict.addItem}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openLazyDialog(dialogs.importList)}>
                    <ClipboardPaste />
                    {dict.importList.triggerLabel}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={addLowStock}>
                    <PackagePlus />
                    {dict.addLowStock}
                  </DropdownMenuItem>
                  {showResolveMappings && (
                    <DropdownMenuItem onClick={() => openLazyDialog(dialogs.resolveMappings)}>
                      <Link2 />
                      {resolveMappingsLabel}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => dialogs.share.open(null)}>
                    <Share2 />
                    {dict.shareLink.button}
                  </DropdownMenuItem>
                  {reorderSections.length >= 2 && (
                    <DropdownMenuItem onClick={() => openLazyDialog(dialogs.reorderSections)}>
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
                <DropdownMenuItem onClick={() => openLazyDialog(dialogs.saveTemplate)}>
                  <ScrollText />
                  {dict.templates.menuItem}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem render={<Link href={`/dashboard/shopping-list/${list.id}/export`} prefetch={false} />}>
                <Download />
                {exportLabel}
              </DropdownMenuItem>
              {pendingItems.length > 0 && (
                <>
                  <DropdownMenuItem onClick={copyListText}>
                    <Copy />
                    {dict.copyText}
                  </DropdownMenuItem>
                  {canShareText && (
                    <DropdownMenuItem onClick={shareListText}>
                      <Share2 />
                      {dict.shareText}
                    </DropdownMenuItem>
                  )}
                </>
              )}
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
                      await archiveListWithUndo(list.id, dict);
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
        <LazyDialog loader={loadPutAwayDialog} open={putAwayMode !== null} onLoadError={closePutAway}>
          {(PutAwayDialog) => (
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
              // UX-80: "Put away & finish" completes right here. The sheet has
              // already said what happens to unbought rows (its carry-over
              // checkbox), so a second "Complete this list?" would only repeat it.
              pendingCount={pendingItems.length}
              carryOverListName={carryOverListName}
              onFinish={(carry) => {
                setCarryOver(carry);
                completeList();
              }}
              numberFormat={numberFormat}
              locations={locations}
              dict={dict}
              autoAddDict={autoAddDict}
            />
          )}
        </LazyDialog>
      )}

      <LazyDialog loader={loadRenameListDialog} handle={dialogs.renameList}>
        {(RenameListDialog) => (
          <RenameListDialog listId={list.id} listName={list.name} dict={dict.renameList} handle={dialogs.renameList} />
        )}
      </LazyDialog>

      {items.length > 0 && (
        <LazyDialog loader={loadSaveTemplateDialog} handle={dialogs.saveTemplate}>
          {(SaveTemplateDialog) => (
            <SaveTemplateDialog listId={list.id} listName={list.name} dict={dict.templates} handle={dialogs.saveTemplate} />
          )}
        </LazyDialog>
      )}

      {isActive && (
        <>
          <LazyDialog loader={loadShoppingItemFormDialog} handle={dialogs.addItem}>
            {(ShoppingItemFormDialog) => (
              <ShoppingItemFormDialog
                mode="create"
                listId={list.id}
                inventoryItems={inventoryItems}
                units={units}
                dict={dict}
                barcodeDict={barcodeDict}
                handle={dialogs.addItem}
              />
            )}
          </LazyDialog>
          <LazyDialog loader={loadImportListDialog} handle={dialogs.importList}>
            {(ImportListDialog) => <ImportListDialog listId={list.id} dict={dict.importList} handle={dialogs.importList} initialText={prefillText} />}
          </LazyDialog>
          <ShareListButton shoppingListId={list.id} dict={dict.shareLink} handle={dialogs.share} />
          <LazyDialog loader={loadReorderSectionsDialog} handle={dialogs.reorderSections}>
            {(ReorderSectionsDialog) => (
              <ReorderSectionsDialog
                sections={reorderSections}
                dict={dict.reorderSections}
                handle={dialogs.reorderSections}
              />
            )}
          </LazyDialog>
          {showResolveMappings && (
            <LazyDialog loader={loadResolveMappingsDialog} handle={dialogs.resolveMappings}>
              {(ResolveMappingsDialog) => (
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
            </LazyDialog>
          )}
          <ConfirmDialog
            handle={dialogs.completeList}
            title={dict.confirmCompleteList.title}
            description={format(plural(pendingItems.length, dict.confirmCompleteList.description), {
              count: pendingItems.length,
            })}
            cancelLabel={dict.confirmCompleteList.cancel}
            confirmLabel={dict.confirmCompleteList.confirm}
            pendingLabel={dict.confirmCompleteList.confirming}
            variant="default"
            onConfirm={completeList}
          >
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox checked={carryOver} onChange={(e) => setCarryOver(e.target.checked)} />
              {format(plural(pendingItems.length, dict.carryOver.label), {
                count: pendingItems.length,
                list: carryOverListName,
              })}
            </label>
          </ConfirmDialog>
          <LazyDialog loader={loadPartialPriceDialog} handle={dialogs.partialPrice}>
            {(PartialPriceDialog) => (
              <PartialPriceDialog
                handle={dialogs.partialPrice}
                suggested={boughtPricedTotal}
                unpriced={boughtPriced.total - boughtPriced.priced}
                total={boughtPriced.total}
                dict={dict.partialPrice}
                onConfirm={runComplete}
              />
            )}
          </LazyDialog>
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

      {showCompleted && <CompletedActions dict={dict} tripSummary={tripSummary} nextListId={nextListId} />}

      <div ref={listRef} className="relative flex flex-col gap-2">
        {showCleared ? (
          <ClearedState
            dict={dict}
            progress={progress}
            celebrate={celebrate}
            onDismiss={dismissCleared}
            // Only once something was actually bought — a list that was
            // simply emptied out has no trip to finish.
            onDone={isActive && purchasedItems.length > 0 ? () => finishTrip(false) : undefined}
            // UX-37: the bags are in hand — offer the put-away straight from
            // here (finishing the list once it's confirmed), on a list that
            // isn't archived, whether or not it's still ACTIVE.
            awaitingPutAway={awaitingPutAway.length}
            tripSummary={tripSummary}
            onPutAway={putEverythingAway}
            onReview={() => setPutAwayMode(isActive ? "finish" : "putAway")}
            // Wait for every tick to save first: the put-away rows and the
            // completion both read what the server has.
            isPending={isPending || isTicking}
          />
        ) : pendingItems.length === 0 && purchasedItems.length === 0 ? (
          <MascotEmptyState alt={dict.mascotAlt}>
            <p className="text-sm text-muted-foreground">{isActive ? dict.emptyListActive : dict.emptyListOther}</p>
          </MascotEmptyState>
        ) : (
          <>
            {/* Shopping mode (AUTO-3): pending items grouped by the linked
                inventory item's category, in the household's store order
                (AUTO-9: learned from check-offs, or arranged by hand) —
                see groupPendingItemsByCategory. Purchased items below stay
                a single flat "Purchased" section, unchanged. */}
            {shownPendingGroups.map((group) => (
              <Fragment key={group.key ?? ""}>
                <p data-flip-key={`label:${group.key ?? ""}`} className="text-xs font-medium uppercase text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <ShoppingRow
                    key={item.id}
                    item={item}
                    onToggle={() => toggleItem(item)}
                    onDelete={deleteItem}
                    leaving={leaving.has(item.id)}
                    highlighted={highlightedIds.has(item.id)}
                    editable={isActive}
                    groupedByCategory
                    isPending={isPending}
                    startTransition={startTransition}
                    inventoryItems={inventoryItems}
                    categories={categories}
                    units={units}
                    dict={dict}
                    numberFormat={numberFormat}
                  />
                ))}
              </Fragment>
            ))}
            {/* UX-37: on an ACTIVE list the ticked rows collapse into "In the
                cart" — out of the way mid-shop, one tap to check or un-tick.
                The rows stay mounted while it's closed (`hidden`), so the
                count's bump is the only thing that moves. A finished or
                archived list is all ticked rows, so there it's the plain,
                always-open "Purchased" section it always was. */}
            {purchasedItems.length > 0 &&
              (isActive ? (
                <Button
                  data-flip-key="label:purchased"
                  variant="ghost"
                  className="mt-4 w-fit justify-start gap-2 px-2 text-xs font-medium uppercase text-muted-foreground"
                  aria-expanded={cartOpen}
                  aria-controls="in-the-cart"
                  onClick={() => setCartOpen((open) => !open)}
                >
                  <ChevronDown className={cn("size-4 transition-transform", !cartOpen && "-rotate-90")} />
                  {dict.shoppingMode.inCart}
                  <Badge
                    // Re-keyed on the count, so each tick that lands here
                    // replays the pop (motion-safe only).
                    key={purchasedItems.length}
                    variant="secondary"
                    className="tabular-nums motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300"
                  >
                    {purchasedItems.length}
                  </Badge>
                </Button>
              ) : (
                <p data-flip-key="label:purchased" className="mt-4 text-xs font-medium uppercase text-muted-foreground">
                  {dict.purchased}
                </p>
              ))}
            <div
              id="in-the-cart"
              data-flip-key="cart"
              hidden={isActive && !cartOpen}
              className="relative flex flex-col gap-2"
            >
              {purchasedItems.map((item) => (
                <ShoppingRow
                  key={item.id}
                  item={item}
                  onToggle={() => toggleItem(item)}
                  onDelete={deleteItem}
                  editable={isActive}
                  isPending={isPending}
                  startTransition={startTransition}
                  inventoryItems={inventoryItems}
                  categories={categories}
                  units={units}
                  dict={dict}
                  numberFormat={numberFormat}
                  // UX-81: only once the trip is over. Mid-shop every cart row would
                  // carry the badge, which is noise: the cart is where they are.
                  awaitingPutAway={list.status === "COMPLETED" && isAwaitingPutAway(item)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* UX-37: one-handed reach. Last in the column so, sticky, it rides
          the bottom of the screen in the thumb zone (DESIGN.md M2). */}
      {isActive && !showCleared && nextUpItems && (
        <NextUpDock next={nextUpItems} progress={progress} dict={dict.shoppingMode} onTick={toggleItem} />
      )}
    </div>
  );
}
