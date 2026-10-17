"use client";

import { useRef } from "react";
import { Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// A swipeable row's Edit and Delete on a phone. SwipeRow's left swipe already
// shows both, so a phone row doesn't also carry their two icon buttons; but
// nothing may be gesture-only (DESIGN.md M7), so this one ⋯ button is their
// tap path. Below `sm` only: from there up the row shows the icons and
// this is hidden.
//
// Like SwipeRow, it clicks the row's own buttons rather than taking
// callbacks: the one marked `data-swipe-edit`, and the one marked
// `data-row-delete` (the trash button, which keeps its confirm dialog).
// Those stay in the DOM on a phone, just `max-sm:hidden`, so their dialogs
// and handlers are the same ones a desktop tap uses.
export function RowActionsMenu({
  label,
  editLabel,
  deleteLabel,
  priceLabel,
  disabled = false,
  className,
}: {
  /** Accessible name of the ⋯ button, with the row's name in it. */
  label: string;
  editLabel: string;
  deleteLabel: string;
  /** A shopping row (UX-79) with no room for "Add price" on its line: an
   *  item that clicks the row's `data-price-edit` button. Omit for none. */
  priceLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  function clickMarked(selector: string) {
    triggerRef.current?.closest("[data-swipe-row]")?.querySelector<HTMLElement>(selector)?.click();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            className={cn("shrink-0 text-muted-foreground sm:hidden", className)}
            disabled={disabled}
            aria-label={label}
          >
            <Ellipsis className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => clickMarked("[data-swipe-edit]")}>{editLabel}</DropdownMenuItem>
        {priceLabel && (
          // Deferred a frame: the menu hands focus back to its ⋯ as it
          // closes, which would take it from the price input's autoFocus.
          <DropdownMenuItem onClick={() => requestAnimationFrame(() => clickMarked("[data-price-edit]"))}>
            {priceLabel}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onClick={() => clickMarked("[data-row-delete]")}>
          {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
