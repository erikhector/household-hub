"use client";

import { toast } from "sonner";
import {
  addInventoryItemsToShoppingListAction,
  freezeItemAction,
  markItemEmptyAction,
  markItemOpenedAction,
  undoFreezeItemAction,
  undoMarkItemOpenedAction,
} from "@/app/dashboard/inventory/actions";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

// The mark-empty, mark-opened and freeze clicks of ItemActions, shared by the
// inventory list and the item page (UX-124) so a row and the page it opens
// toast, undo and fail the same way. `run` is the caller's own transition
// starter (the list's and the page's each drive their own pending state).
export function useItemHandlers({
  dict,
  locale,
  run,
}: {
  dict: Dictionary["inventory"];
  locale: Locale;
  run: (action: () => Promise<void>) => void;
}) {
  // UX-122: leaves stock alone; the toast says when everything was already
  // on the list rather than claiming an add that didn't happen. `onDone`
  // runs after a successful answer (the list clears its bulk selection).
  function addToShoppingList(ids: string[], onDone?: () => void) {
    run(async () => {
      const result = await addInventoryItemsToShoppingListAction(ids);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const list = result.listName ?? "";
      const added = result.added ?? 0;
      if (added === 0) {
        toast.success(format(plural(ids.length, dict.addToList.alreadyToast), { count: ids.length, list }));
      } else {
        toast.success(format(plural(added, dict.addToList.addedToast), { count: added, list }));
      }
      onDone?.();
    });
  }

  function handleMarkEmpty(item: { id: string; name: string }, addToShoppingList: boolean) {
    run(async () => {
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
  function handleMarkOpened(item: { id: string; name: string }) {
    run(async () => {
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

  // GAP-44: same shape as handleMarkOpened: applied straight away, Undo on
  // the toast restores the snapshot unless the item changed since.
  function handleFreeze(item: { id: string; name: string }) {
    run(async () => {
      const result = await freezeItemAction(item.id);
      if (result.error || !result.frozenAt || !result.expiresAt || !result.previous) {
        if (result.error) toast.error(result.error);
        return;
      }
      const { frozenAt, previous } = result;
      const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(result.expiresAt);
      toast.success(format(dict.frozenToast, { name: item.name, date }), {
        duration: 8000,
        action: {
          label: dict.undoFreeze,
          onClick: () => {
            void undoFreezeItemAction(item.id, frozenAt, previous).then((undoResult) => {
              if (undoResult.error) toast.error(undoResult.error);
              else toast.success(format(dict.freezeUndoneToast, { name: item.name }));
            });
          },
        },
      });
    });
  }

  return { addToShoppingList, handleMarkEmpty, handleMarkOpened, handleFreeze };
}
