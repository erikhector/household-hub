"use client";

import { Pencil, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DialogHandle } from "@/components/ui/dialog";
import { openLazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import { loadShoppingItemFormDialog } from "@/components/shopping/lazy-dialogs";

/**
 * A row's openers for its edit dialog: the pencil, and for a row that isn't
 * linked to an inventory item yet the "Match item" badge. They stay in the
 * page's own chunk while the form they open is lazy (PERF-25), so they reach
 * it through the row's `handle` and warm the chunk as the pointer or focus
 * arrives.
 */
export function ShoppingItemEditTriggers({
  handle,
  unlinked,
  editAriaLabel,
  matchItemLabel,
}: {
  handle: DialogHandle;
  /** No inventory item behind the row: offer "Match item". */
  unlinked: boolean;
  editAriaLabel: string;
  matchItemLabel: string;
}) {
  const open = () => openLazyDialog(handle);
  const intent = preloadOnIntent(loadShoppingItemFormDialog);
  return (
    <>
      <Button
        type="button"
        data-swipe-edit
        variant="ghost"
        size="icon"
        // Phones reach it through the row's ⋯ (RowActionsMenu) or
        // its left swipe instead.
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground max-sm:hidden"
        aria-label={editAriaLabel}
        aria-haspopup="dialog"
        onClick={open}
        {...intent}
      >
        <Pencil className="size-3.5" />
      </Button>
      {unlinked && (
        <Badge
          // `warning` is the tinted pair (text on its own 10% tint)
          // that clears contrast in light mode, where bare
          // text-warning on the card didn't; the icon means the
          // state isn't carried by colour alone. `order-first` puts
          // it in the leading slot the category chip takes on a
          // linked row, so a row's controls always read
          // [chip or match][price][edit][delete] (UX-22). Accepted
          // trade-off: tab order puts it after the price, because the
          // openers sit together with the edit button.
          variant="warning"
          className="touch-target order-first shrink-0 cursor-pointer justify-center"
          render={<button type="button" aria-haspopup="dialog" onClick={open} {...intent} />}
        >
          <TriangleAlert aria-hidden />
          {matchItemLabel}
        </Badge>
      )}
    </>
  );
}
