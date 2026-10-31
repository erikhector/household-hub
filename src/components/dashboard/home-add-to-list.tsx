"use client";

// UX-HOME-3: Home's one primary action. Adding an item is the most frequent
// write in the app and used to take three taps from here (Shopping, the
// list, "+"), so "Add to list" opens the shopping list's own quick-add
// dialog (ShoppingItemFormDialog's create mode) in place, for the list Home
// adds to (pickTargetList). The dialog is the same lazily loaded chunk the
// list page uses, fetched in idle time or on intent, so it costs this page
// nothing until it's needed. With no active list there is nothing to add to
// yet, so the button becomes a link to the lists page, whose "New list" is
// the next step.

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createDialogHandle } from "@/components/ui/dialog";
import { LazyDialog, openLazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import { PrimaryAction } from "@/components/dashboard/primary-action";
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
  /** The list to add to; null when the household has no active list. */
  listId: string | null;
  inventoryItems: { id: string; name: string; category: string; unit: string }[];
  units: string[];
  dict: ShoppingItemFormDialogDict;
  barcodeDict: Dictionary["barcodeScanner"];
}) {
  const [handle] = useState(() => createDialogHandle());

  if (!listId) {
    return (
      <PrimaryAction>
        <Button render={<Link href="/dashboard/shopping-list" />}>
          <Plus className="size-4" />
          {label}
        </Button>
      </PrimaryAction>
    );
  }

  return (
    <PrimaryAction>
      <Button onClick={() => openLazyDialog(handle)} {...preloadOnIntent(loadShoppingItemFormDialog)}>
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
    </PrimaryAction>
  );
}
