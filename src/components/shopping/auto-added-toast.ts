"use client";

import { toast } from "sonner";
import { undoAutoAddedItemsAction } from "@/app/dashboard/shopping-list/item-actions";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { AutoAddedItem } from "@/lib/shopping/default-list";

// The "Added Milk to Next shop · Undo" toast (AUTO-8), shared by every
// client that calls an action which can auto-add (inventory +/- and mark
// empty, the edit form, bulk edit, AI shelf scan, un-checking a shopping
// row). Undo over confirm, per BACKLOG.md's Guardrails: the likely thing
// already happened, and one tap takes back exactly the rows it created —
// the ids the action returned, never "whatever is on the list".
//
// Mark meal as cooked doesn't use this: it folds the auto-adds into its own
// existing Undo toast instead of stacking a second one (see
// MarkCookedDialog).
export function showAutoAddedToast(autoAdded: AutoAddedItem[] | undefined, dict: Dictionary["inventory"]["autoAdd"]) {
  if (!autoAdded || autoAdded.length === 0) return;

  // Every auto-add targets the one default list, so the first row's name
  // stands for all of them.
  const list = autoAdded[0].listName;
  const message =
    autoAdded.length === 1
      ? format(dict.addedToast, { name: autoAdded[0].itemName, list })
      : format(plural(autoAdded.length, dict.addedManyToast), { count: autoAdded.length, list });
  const ids = autoAdded.map((added) => added.shoppingListItemId);

  toast.success(message, {
    duration: 8000,
    action: {
      label: dict.undo,
      onClick: () => {
        void undoAutoAddedItemsAction(ids).then((result) => {
          if (result.error) toast.error(result.error);
          else toast.success(format(dict.undoneToast, { list }));
        });
      },
    },
  });
}
