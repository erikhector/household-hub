"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  CheckCheck,
  ChevronDown,
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
  deleteShoppingListItemAction,
  generateFromLowStockAction,
  resetCategoryOrderAction,
  saveCategoryOrderAction,
  putAwayItemsAction,
  togglePurchasedAction,
  unarchiveShoppingListAction,
  uncompleteShoppingListAction,
} from "@/app/dashboard/shopping-list/actions";
import { format, plural } from "@/lib/i18n/format";
import { tripDurationMinutes } from "@/lib/shopping/trip-summary";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { archiveListWithUndo } from "@/components/shopping/archive-list";
import { startUndoableDelete } from "@/components/shared/start-undoable-delete";
import { cn } from "@/lib/utils";
import type { SmartAddCandidate } from "@/lib/shopping/smart-add-suggestions";
import { groupPendingItemsByCategory } from "@/lib/shopping/shopping-mode-grouping";
import type { StoreOrder } from "@/lib/shopping/store-order";
import { countPriced, sumEstimatedPendingTotal } from "@/lib/shopping/estimated-total";
import { nextUp, shoppingProgress } from "@/lib/shopping/shopping-progress";
import {
  hasTicksInFlight,
  NO_TICKS,
  reconcileTicks,
  shownPurchased,
  tickSettled,
  tickStarted,
  type TickOverlay,
} from "@/lib/shopping/tick-overlay";
import { useScreenWakeLock } from "@/lib/shopping/use-screen-wake-lock";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";
import { awaitsReceiptPrice, isAwaitingPutAway, withLocalTick } from "@/lib/shopping/put-away-calc";
import { applyLocalRowChanges, settleDelete, useLocalRowChanges } from "@/components/shared/local-row-changes";
import { useFlipList } from "@/components/shared/use-flip-list";
import type { ItemAliasLike } from "@/lib/item-alias";
import { useUnitLabel } from "@/components/units-provider";
import { canNativeShare } from "@/components/ui/copy-link-button";
import { formatShoppingListText } from "@/lib/shopping-list-text";
import { PageTitle } from "@/components/dashboard/page-title";
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";
import { PrintableList } from "@/components/shopping/printable-list";
import { ClearedState, CompletedActions } from "@/components/shopping/cleared-state";
import { ShoppingRow } from "@/components/shopping/shopping-row";
import type {
  InventoryItemOption,
  ShoppingListData,
  ShoppingListDict,
  ShoppingListItemRow,
} from "@/components/shopping/shopping-list-types";

// Below this many unlinked items, resolving them one at a time via each
// row's edit dialog is fine; above it, the batch ResolveMappingsDialog is
// offered instead so the user isn't clicking into the same dialog N times.
const BATCH_RESOLVE_THRESHOLD = 3;

// How long a row the smart add line just added stays highlighted — long
// enough to spot where it landed, short enough to be gone by the next add.
const ADDED_HIGHLIGHT_MS = 2000;

// UX-37: how long a just-ticked row stays in its aisle, animating out,
// before it moves into "In the cart". Matches the row's exit animation.
// UX-54: 250, not 350: the tick now lands TICK_MS (200) after the tap, and
// the aisle closing up must still happen inside the 500 ms after input that
// layout shift (CLS) forgives.
const LEAVE_MS = 250;


const subscribeNever = () => () => {};

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

  // UX-14 + UX-37: ticking is instant. Every tick — a row's checkbox or the
  // Next up dock — flips the row here, before the server answers, so on
  // weak in-store signal you can tick the next three items while the first
  // save is still on its way, and nothing greys out meanwhile. It lives up
  // here, not per row (as UX-14 had it), because a ticked row now *moves*:
  // out of its aisle and into "In the cart" (and its dock button goes), and
  // the ring and the all-done moment follow it at once.
  //
  // Plain state (tick-overlay.ts), not useOptimistic in a transition: React
  // 19 entangles concurrent async transitions, so one shared (or even
  // per-row) optimistic transition only dropped a failed tick once *every*
  // tick in flight had settled, leaving the row in "In the cart" after its
  // save failed. Each tick now settles on its own: a failure puts its row
  // back at once (settleOptimisticAction adds the toast that says why), and
  // a success holds the tick until the next server list, which then wins.
  //
  // The overlay and the server rows it was last reconciled against are one
  // state, so a tick that settles reads the newest list React has seen, not
  // a copy an effect hasn't caught up with yet: when the revalidated list
  // renders before the save's promise settles, the tick is checked against
  // that list and goes at once.
  const [tickState, setTickState] = useState<{ overlay: TickOverlay; items: ShoppingListItemRow[] }>({
    overlay: NO_TICKS,
    items: list.items,
  });
  // A new server list (a save's revalidation, another member's change)
  // retires every settled tick: adjusted during render, React's pattern for
  // state derived from a changed prop, so a saved row never shows one frame
  // unticked.
  if (tickState.items !== list.items) {
    setTickState((current) => ({ overlay: reconcileTicks(current.overlay, list.items), items: list.items }));
  }
  const ticks = tickState.overlay;
  const isTicking = hasTicksInFlight(ticks);
  // UX-33: deletes go at tap time too (local-row-changes.ts), and a tick
  // shows the row the way the server will leave it (withLocalTick: put
  // away at once, or waiting in the cart in put-away mode), so the "Put
  // away" button comes with the tap rather than when the server answers.
  const local = useLocalRowChanges(list.items);
  const items = applyLocalRowChanges(
    list.items.map((item) => {
      const purchased = shownPurchased(ticks, item.id, item.purchased);
      return purchased === item.purchased ? item : withLocalTick(item, purchased, defersToPutAway, new Date());
    }),
    local.changes,
    (item) => item,
  );
  // UX-49: every delete (the swipe, the trash icon, the ⋯ menu) takes the
  // row out at tap time, like a tick, and the server hears of it when the
  // Undo toast closes. Out of the list's own items rather than hidden in the
  // row, so the aisle header and the "Next up" dock go with it at once; a
  // dock that changed five seconds later would shift the layout with no tap
  // behind it. Undo drops the mark and the row is back.
  const deleteItem = (item: ShoppingListItemRow) => {
    const settle = local.markDeleted(item.id);
    startUndoableDelete({
      run: async () => {
        const result = await settleDelete(settle, deleteShoppingListItemAction(item.id), dict.saveFailedToast);
        if (result.error) toast.error(result.error);
        return !result.error;
      },
      restore: () => settle(false),
      message: format(dict.swipe.deletedToast, { name: item.name }),
      undoLabel: dict.swipe.undo,
    });
  };
  // UX-33: rows glide when they move (use-flip-list.ts). A row leaving its
  // aisle (`leaving` below) has its own drop-out animation instead.
  const listRef = useFlipList<HTMLDivElement>();

  // Rows just ticked stay in their aisle for LEAVE_MS while they animate
  // out towards "In the cart", so the eye sees where they went. Skipped
  // under prefers-reduced-motion: the row simply moves.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const leaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = leaveTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);
  const setLeavingRow = (id: string, on: boolean) => {
    const timer = leaveTimers.current.get(id);
    if (timer) clearTimeout(timer);
    leaveTimers.current.delete(id);
    setLeaving((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    if (on) {
      leaveTimers.current.set(
        id,
        setTimeout(() => setLeavingRow(id, false), LEAVE_MS),
      );
    }
  };

  // `item` is the row as shown (overlay applied); the overlay reads the
  // server's own `purchased` for the row from the same state it updates.
  const serverPurchased = (rows: ShoppingListItemRow[], id: string) =>
    rows.find((row) => row.id === id)?.purchased ?? false;
  const [celebrate, setCelebrate] = useState(false);
  const toggleItem = (item: ShoppingListItemRow) => {
    const ticking = !item.purchased;
    // UX-38: ticking the last thing left on an active list is the moment the
    // trip is done, so that (and only that) earns the small celebration. It's
    // decided here, in the tap, rather than from isCleared, so opening a list
    // that's already all ticked, or deleting its last row, stays quiet.
    if (ticking && isActive && pendingItems.length === 1 && pendingItems[0].id === item.id) setCelebrate(true);
    setLeavingRow(item.id, ticking && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setTickState((current) => ({
      ...current,
      overlay: tickStarted(current.overlay, item.id, serverPurchased(current.items, item.id)),
    }));
    void (async () => {
      const result = await settleOptimisticAction(() => togglePurchasedAction(item.id), dict.saveFailedToast);
      if (!result) {
        setLeavingRow(item.id, false);
        setCelebrate(false);
      }
      setTickState((current) => ({
        ...current,
        overlay: tickSettled(current.overlay, item.id, result !== null, serverPurchased(current.items, item.id)),
      }));
      if (result) showAutoAddedToast(result.autoAdded, autoAddDict);
    })();
  };

  const pendingItems = items.filter((item) => !item.purchased);
  const purchasedItems = items.filter((item) => item.purchased);
  // What the aisles show: everything pending, plus the rows still on their
  // way out (see `leaving`).
  const shownPendingItems = items.filter((item) => !item.purchased || leaving.has(item.id));
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
  // GAP-53: the open items as plain text, on the clipboard or (a phone, via
  // the system share sheet) sent on. Nothing is stored or shared through the
  // app. The success toast waits for the write (clipboard.writeText rejects
  // when the page is unfocused or permission is denied), as CopyLinkButton.
  const unitLabel = useUnitLabel();
  const canShareText = useSyncExternalStore(subscribeNever, canNativeShare, () => false);
  const listText = () => formatShoppingListText(list.name, pendingGroups, locale, unitLabel);
  const copyListText = async () => {
    try {
      await navigator.clipboard.writeText(listText());
      toast.success(dict.copyTextToast);
    } catch {
      toast.error(dict.copyTextFailedToast);
    }
  };
  const shareListText = async () => {
    try {
      await navigator.share({ title: list.name, text: listText() });
    } catch (err) {
      // Closing the sheet rejects with AbortError: a choice, not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error(dict.copyTextFailedToast);
    }
  };
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
  const carryOverRef = useRef(true);
  const [carryOver, setCarryOverState] = useState(true);
  const setCarryOver = (value: boolean) => {
    carryOverRef.current = value;
    setCarryOverState(value);
  };

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
    if (!isCleared) {
      setClearedDismissed(false);
      setCelebrate(false);
    }
  }
  // A completed list with nothing left to put away has no "All done" to
  // show: its own card (CompletedActions) says the trip is over instead.
  const showCleared = isCleared && !clearedDismissed && (isActive || awaitingPutAway.length > 0);
  const showCompleted = list.status === "COMPLETED" && !showCleared && purchasedItems.length > 0;

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
            {(ImportListDialog) => <ImportListDialog listId={list.id} dict={dict.importList} handle={dialogs.importList} />}
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
            onDismiss={() => setClearedDismissed(true)}
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
