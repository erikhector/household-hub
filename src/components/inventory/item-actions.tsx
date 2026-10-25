"use client";

import React from "react";
import Link from "next/link";
import { Ban, Info, PackageOpen, Pencil, ShoppingCart, Snowflake, Trash2, Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ItemFormDialog } from "@/components/inventory/add-item-dialog";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { HouseholdMemberOption, InventoryItemRow } from "@/components/inventory/inventory-table-utils";

// Shared between the desktop table row and the mobile card (see
// InventoryTable) so the details/mark-empty/edit/delete cluster — and its touch-
// target sizing — only needs to be defined once.
export function ItemActions({
  item,
  categories,
  locations,
  units,
  members,
  locale,
  dict,
  barcodeDict,
  isPending,
  autoAddEnabled = false,
  onAddToList,
  onMarkEmpty,
  onMarkOpened,
  onFreeze,
  onDelete,
  size = "size-7",
  hideDetails = false,
}: {
  item: InventoryItemRow;
  categories: string[];
  locations: string[];
  units: string[];
  members: HouseholdMemberOption[];
  locale: Locale;
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  isPending: boolean;
  /** UX-122: with the household's low-stock auto-add on, plain "Mark as
   * empty" already puts the item on the list, so the "& add to shopping
   * list" entry would be a duplicate and is left out. */
  autoAddEnabled?: boolean;
  /** UX-122: puts the item on the list and leaves its stock unchanged. */
  onAddToList: (item: InventoryItemRow) => void;
  onMarkEmpty: (item: InventoryItemRow, addToShoppingList: boolean) => void;
  onMarkOpened: (item: InventoryItemRow) => void;
  onFreeze: (item: InventoryItemRow) => void;
  /** UX-49: hides the item and offers Undo; the delete itself is deferred. */
  onDelete: (item: InventoryItemRow) => void;
  size?: string;
  /** UX-124: the item page is the details page, so its own cluster leaves
   * the "Details" link out rather than link to itself. */
  hideDetails?: boolean;
}) {
  // GAP-28: hidden (not disabled) unless there's an opened window to apply
  // and the pack isn't already open — a button that would only ever no-op
  // is noise on every other row.
  const canMarkOpened = item.useWithinDaysOpened != null && item.useWithinDaysOpened > 0 && !item.openedAt;
  // GAP-44: only an item with an expiry date to extend, and not frozen yet.
  const canFreeze = item.expiresAt != null && !item.frozenAt;
  // A ref for the edit dialog's trigger so the mobile menu can open it
  // without rendering the dialog inside the menu popup (which would unmount
  // it as the menu closes).
  const editRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <div className="flex items-center gap-1 max-sm:gap-2 pointer-coarse:gap-2">
      {/* Desktop: show individual controls */}
      {canMarkOpened && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(size, "text-muted-foreground hover:text-primary hidden sm:inline-flex")}
          disabled={isPending}
          aria-label={format(dict.markOpenedAriaLabel, { name: item.name })}
          title={dict.markOpened}
          onClick={() => onMarkOpened(item)}
        >
          <PackageOpen className="size-3.5" />
        </Button>
      )}
      {canFreeze && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(size, "text-muted-foreground hover:text-primary hidden sm:inline-flex")}
          disabled={isPending}
          aria-label={format(dict.freezeAriaLabel, { name: item.name })}
          title={dict.freeze}
          onClick={() => onFreeze(item)}
        >
          <Snowflake className="size-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={cn(size, "text-muted-foreground hover:text-primary hidden sm:inline-flex")}
        disabled={isPending}
        aria-label={format(dict.addToList.ariaLabel, { name: item.name })}
        title={dict.addToList.menu}
        onClick={() => onAddToList(item)}
      >
        <ShoppingCart className="size-3.5" />
      </Button>
      {!hideDetails && (
        <Link
          href={`/dashboard/inventory/items/${item.id}`}
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), size, "text-muted-foreground hover:text-primary hidden sm:inline-flex")}
          aria-label={format(dict.detailsAriaLabel, { name: item.name })}
          title={dict.details}
        >
          <Info className="size-3.5" />
        </Link>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={cn(size, "text-muted-foreground hover:text-warning hidden sm:inline-flex")}
              disabled={isPending}
              aria-label={dict.markEmptyAriaLabel}
            >
              <Ban className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onMarkEmpty(item, false)}>{dict.markEmpty}</DropdownMenuItem>
          {!autoAddEnabled && (
            <DropdownMenuItem onClick={() => onMarkEmpty(item, true)}>
              {dict.markEmptyAndAddToList}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit & delete. On a phone both live in the ⋯ menu: the card's
          left swipe (SwipeRow) shows them too, so a visible icon would be a
          third copy. The edit button stays mounted there, hidden, as the
          one the menu and the swipe both click. */}
      <ItemFormDialog
        mode="edit"
        item={item}
        categories={categories}
        locations={locations}
        units={units}
        members={members}
        locale={locale}
        dict={dict}
        barcodeDict={barcodeDict}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            ref={editRef}
            data-swipe-edit
            className={cn(size, "text-muted-foreground hover:text-primary hidden sm:inline-flex")}
            aria-label={dict.editAriaLabel}
            title={dict.edit}
          >
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      {/* UX-49: Delete removes at once and offers Undo in a toast, instead
          of a "can't be undone" confirm. */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(size, "text-muted-foreground hover:text-destructive hidden sm:inline-flex")}
        disabled={isPending}
        aria-label={dict.deleteAriaLabel}
        onClick={() => onDelete(item)}
      >
        <Trash2 className="size-3.5" />
      </Button>

      {/* Mobile: collapsed ⋯ menu that opens the actions */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className={cn(size, "sm:hidden")} aria-label={dict.moreActions}>
              <Ellipsis className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => editRef.current?.click()}>{dict.edit}</DropdownMenuItem>
          {canMarkOpened && <DropdownMenuItem onClick={() => onMarkOpened(item)}>{dict.markOpened}</DropdownMenuItem>}
          {canFreeze && <DropdownMenuItem onClick={() => onFreeze(item)}>{dict.freeze}</DropdownMenuItem>}
          {!hideDetails && (
            <DropdownMenuItem render={<Link href={`/dashboard/inventory/items/${item.id}`} prefetch={false} />}>{dict.details}</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => onAddToList(item)}>{dict.addToList.menu}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMarkEmpty(item, false)}>{dict.markEmpty}</DropdownMenuItem>
          {!autoAddEnabled && (
            <DropdownMenuItem onClick={() => onMarkEmpty(item, true)}>{dict.markEmptyAndAddToList}</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => onDelete(item)}>{dict.delete}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
