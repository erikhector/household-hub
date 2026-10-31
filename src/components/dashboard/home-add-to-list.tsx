"use client";

// UX-HOME-3: Home's one-tap "Add to list". Adding an item is the most
// frequent write in the app and used to take three taps from here (Shopping,
// the list, "+"), so this opens the shopping list's own quick-add dialog
// (ShoppingItemFormDialog's create mode) in place, for the list Home adds to
// (pickTargetList). The dialog is the same lazily loaded chunk the list page
// uses, fetched in idle time or on intent, so it costs this page nothing
// until it's needed.
//
// Home is a summary with no primary action (it answers "what needs me
// now?" and hands off to the feature pages), so this is a small outline
// button in the Shopping & pantry card's header, beside the list it fills,
// not a floating `PrimaryAction` pill. It only renders with an active list:
// without one the card's own "Start a list" row is the next step.

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createDialogHandle } from "@/components/ui/dialog";
import { LazyDialog, openLazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import { loadShoppingItemFormDialog } from "@/components/shopping/lazy-dialogs";
import type { ShoppingItemFormDialogDict } from "@/components/shopping/shopping-item-form-dialog";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function HomeAddToList({
  label,
  listId,
  inventoryItems,
  units,
  dict,
  barcodeDict,
}: {
  label: string;
  /** The list to add to (pickTargetList). */
  listId: string;
  inventoryItems: { id: string; name: string; category: string; unit: string }[];
  units: string[];
  dict: ShoppingItemFormDialogDict;
  barcodeDict: Dictionary["barcodeScanner"];
}) {
  const [handle] = useState(() => createDialogHandle());

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => openLazyDialog(handle)}
        {...preloadOnIntent(loadShoppingItemFormDialog)}
      >
        <Plus className="size-4" />
        {label}
      </Button>
      <LazyDialog loader={loadShoppingItemFormDialog} handle={handle}>
        {(ShoppingItemFormDialog) => (
          <ShoppingItemFormDialog
            mode="create"
            listId={listId}
            inventoryItems={inventoryItems}
            units={units}
            dict={dict}
            barcodeDict={barcodeDict}
            handle={handle}
          />
        )}
      </LazyDialog>
    </>
  );
}
