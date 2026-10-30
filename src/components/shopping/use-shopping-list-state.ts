"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { replayTickAction, togglePurchasedAction } from "@/app/dashboard/shopping-list/purchase-actions";
import { deleteShoppingListItemAction } from "@/app/dashboard/shopping-list/item-actions";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import type { ShoppingListData, ShoppingListDict, ShoppingListItemRow } from "@/components/shopping/shopping-list-types";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { startUndoableDelete } from "@/components/shared/start-undoable-delete";
import { applyLocalRowChanges, settleDelete, useLocalRowChanges } from "@/components/shared/local-row-changes";
import { useFlipList } from "@/components/shared/use-flip-list";
import { canNativeShare } from "@/components/ui/copy-link-button";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { formatShoppingListText } from "@/lib/shopping-list-text";
import { queuedPurchased, queueTick } from "@/lib/shopping/offline-tick-queue";
import {
  getQueuedTicks,
  getServerQueuedTicks,
  replayQueuedTicks,
  setQueuedTicks,
  subscribeQueuedTicks,
} from "@/lib/shopping/offline-tick-queue-store";
import { withLocalTick } from "@/lib/shopping/put-away-calc";
import {
  hasTicksInFlight,
  NO_TICKS,
  reconcileTicks,
  shownPurchased,
  tickSettled,
  tickStarted,
  type TickOverlay,
} from "@/lib/shopping/tick-overlay";

// State hooks for ShoppingListClient (MAINT-10). Pulled out of the component
// so each concern reads on its own; none of them changes behaviour, and the
// comments moved with the code they explain.

// How long a row the smart add line just added stays highlighted — long
// enough to spot where it landed, short enough to be gone by the next add.
const ADDED_HIGHLIGHT_MS = 2000;

// UX-37: how long a just-ticked row stays in its aisle, animating out,
// before it moves into "In the cart". Matches the row's exit animation.
// UX-54: 250, not 350: the tick now lands TICK_MS (200) after the tap, and
// the aisle closing up must still happen inside the 500 ms after input that
// layout shift (CLS) forgives.
const LEAVE_MS = 250;

// UX-36: how often queued ticks are retried while the browser claims to be
// online but the requests keep failing.
const QUEUED_TICK_RETRY_MS = 10_000;

const subscribeNever = () => () => {};

/**
 * Ticking, deleting and the offline queue: everything that decides which
 * rows the list shows and in which state. Returns the rows as shown (server
 * list plus the tick overlay, the offline queue and local deletes) and the
 * two row handlers.
 */
export function useShoppingTicks({
  list,
  defersToPutAway,
  dict,
  autoAddDict,
  demo = false,
}: {
  list: ShoppingListData;
  defersToPutAway: boolean;
  dict: ShoppingListDict;
  /** AUTO-8: un-checking a row can drop its item back into low stock and
   * onto "Next shop" — see showAutoAddedToast. */
  autoAddDict: Dictionary["inventory"]["autoAdd"];
  /** The landing page's product shot (ShoppingListClient `demo`): example
   * rows nobody can tick, so the visitor's offline queue is never read or
   * replayed from here. */
  demo?: boolean;
}) {
  const router = useRouter();
  const isActive = list.status === "ACTIVE";

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
  // UX-36: ticks made offline wait in a queue on this device (see
  // offline-tick-queue.ts). A queued wish outranks the overlay, which only
  // knows about saves on their way, so the row keeps showing it until the
  // replay has saved it and the server's own list says the same.
  const queuedTicks = useSyncExternalStore(
    demo ? subscribeNever : subscribeQueuedTicks,
    demo ? getServerQueuedTicks : getQueuedTicks,
    getServerQueuedTicks,
  );
  const items = applyLocalRowChanges(
    list.items.map((item) => {
      const purchased = queuedPurchased(queuedTicks, item.id) ?? shownPurchased(ticks, item.id, item.purchased);
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
  const pendingItems = items.filter((item) => !item.purchased);
  const toggleItem = (item: ShoppingListItemRow) => {
    const ticking = !item.purchased;
    // UX-38: ticking the last thing left on an active list is the moment the
    // trip is done, so that (and only that) earns the small celebration. It's
    // decided here, in the tap, rather than from isCleared, so opening a list
    // that's already all ticked, or deleting its last row, stays quiet.
    if (ticking && isActive && pendingItems.length === 1 && pendingItems[0].id === item.id) setCelebrate(true);
    setLeavingRow(item.id, ticking && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    // UX-36: with no connection (or ticks already waiting, which must go
    // first so the order holds) the tap joins the queue instead of calling
    // the server. The row moves at once like any tick; the chip says it is
    // waiting. `item` is what the row shows, so `ticking` is the wish.
    if (!navigator.onLine || getQueuedTicks().length > 0) {
      setQueuedTicks(queueTick(getQueuedTicks(), item.id, ticking, serverPurchased(tickState.items, item.id)));
      return;
    }
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

  // UX-36: save the queued ticks as soon as there is a connection: when the
  // browser says it is back, when the list opens with some left over from
  // before, and when a tap was queued while the connection was fine (ticks
  // already waiting). The server rows are re-fetched afterwards so the list
  // shows what was really saved (a row someone else ticked meanwhile, a
  // deleted row gone).
  const hasQueuedTicks = queuedTicks.length > 0;
  useEffect(() => {
    if (!hasQueuedTicks) return;
    const replay = () => {
      if (!navigator.onLine) return;
      void replayQueuedTicks(
        ({ itemId, purchased }) => replayTickAction(itemId, purchased),
        () => toast.error(dict.saveFailedToast),
      ).then((settled) => {
        if (settled) router.refresh();
      });
    };
    const replayWhenVisible = () => {
      if (document.visibilityState === "visible") replay();
    };
    replay();
    window.addEventListener("online", replay);
    document.addEventListener("visibilitychange", replayWhenVisible);
    // A "dead zone" (the radio says online, requests fail) never fires an
    // `online` event and leaves hasQueuedTicks true, so this effect wouldn't
    // run again: the pass stops at the first failed request and the queue
    // would sit until a reload. Retry on a timer while anything is queued;
    // a pass already running makes the extra call a no-op.
    const retry = window.setInterval(replay, QUEUED_TICK_RETRY_MS);
    return () => {
      window.removeEventListener("online", replay);
      document.removeEventListener("visibilitychange", replayWhenVisible);
      window.clearInterval(retry);
    };
  }, [hasQueuedTicks, router, dict.saveFailedToast]);

  return {
    items,
    pendingItems,
    purchasedItems: items.filter((item) => item.purchased),
    // What the aisles show: everything pending, plus the rows still on their
    // way out (see `leaving`).
    shownPendingItems: items.filter((item) => !item.purchased || leaving.has(item.id)),
    leaving,
    celebrate,
    setCelebrate,
    queuedTicks,
    hasQueuedTicks,
    isTicking,
    toggleItem,
    deleteItem,
    listRef,
  };
}

/**
 * The put-away dialog's open state. null = closed; "finish" = opened from
 * "Done shopping"/"Complete list" while rows are still waiting, so
 * confirming also completes the list.
 */
export function usePutAwayDialog(awaitingCount: number) {
  const [putAwayMode, setPutAwayMode] = useState<"putAway" | "finish" | null>(null);

  // The put-away reminder (push and bell) links here with `?putAway=1`.
  // Watched as it changes, not just read on mount: tapping the bell while
  // this list is already open is a client-side navigation that only
  // changes the search params. Adjust-state-during-render, like the
  // cleared-state tracking, so it opens in the same render. Closing
  // the dialog strips the param again, so the next tap is a change too.
  const router = useRouter();
  const pathname = usePathname();
  const putAwayParam = useSearchParams().get("putAway");
  const [seenPutAwayParam, setSeenPutAwayParam] = useState<string | null>(null);
  if (putAwayParam !== seenPutAwayParam) {
    setSeenPutAwayParam(putAwayParam);
    if (putAwayParam === "1" && awaitingCount > 0) setPutAwayMode("putAway");
  }
  const closePutAway = () => {
    setPutAwayMode(null);
    if (putAwayParam !== null) router.replace(pathname, { scroll: false });
  };
  return { putAwayMode, setPutAwayMode, closePutAway };
}

/**
 * UX-80: whether completing moves the unbought rows to the next list. A ref
 * beside the state because the put-away sheet sets it and completes in the
 * same tick, before a re-render would hand runComplete the new value.
 */
export function useCarryOver() {
  const carryOverRef = useRef(true);
  const [carryOver, setCarryOverState] = useState(true);
  const setCarryOver = (value: boolean) => {
    carryOverRef.current = value;
    setCarryOverState(value);
  };
  return { carryOver, carryOverRef, setCarryOver };
}

/**
 * The "All done" card's state. "Cleared" covers two cases: every item got
 * checked off (purchasedCount non-zero), or the list was emptied out
 * entirely after having had items this session (hadItems distinguishes that
 * from a list that's simply never had anything added to it, which gets the
 * plain empty state).
 */
export function useClearedState({
  itemCount,
  pendingCount,
  purchasedCount,
  setCelebrate,
}: {
  itemCount: number;
  pendingCount: number;
  purchasedCount: number;
  setCelebrate: Dispatch<SetStateAction<boolean>>;
}) {
  const [hadItems, setHadItems] = useState(itemCount > 0);
  if (itemCount > 0 && !hadItems) setHadItems(true);
  const isCleared = pendingCount === 0 && (purchasedCount > 0 || (itemCount === 0 && hadItems));

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
  return { isCleared, clearedDismissed, dismissCleared: () => setClearedDismissed(true) };
}

/** The rows the smart add line just added, highlighted for a moment. */
export function useAddedHighlight() {
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
  return { highlightedIds, highlightAdded };
}

/**
 * GAP-53: the open items as plain text, on the clipboard or (a phone, via
 * the system share sheet) sent on. Nothing is stored or shared through the
 * app. The success toast waits for the write (clipboard.writeText rejects
 * when the page is unfocused or permission is denied), as CopyLinkButton.
 */
export function useListTextShare({
  listName,
  groups,
  locale,
  unitLabel,
  dict,
}: {
  listName: string;
  groups: Parameters<typeof formatShoppingListText>[1];
  locale: Locale;
  unitLabel: Parameters<typeof formatShoppingListText>[3];
  dict: ShoppingListDict;
}) {
  const canShareText = useSyncExternalStore(subscribeNever, canNativeShare, () => false);
  const listText = () => formatShoppingListText(listName, groups, locale, unitLabel);
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
      await navigator.share({ title: listName, text: listText() });
    } catch (err) {
      // Closing the sheet rejects with AbortError: a choice, not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error(dict.copyTextFailedToast);
    }
  };
  return { canShareText, copyListText, shareListText };
}
