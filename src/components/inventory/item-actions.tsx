"use client";

import React from "react";
import Link from "next/link";
import { Ban, Info, PackageOpen, Pencil, Trash2, Ellipsis } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  onMarkEmpty,
  onMarkOpened,
  onDelete,
  size = "size-7",
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
  onMarkEmpty: (item: InventoryItemRow, addToShoppingList: boolean) => void;
  onMarkOpened: (item: InventoryItemRow) => void;
  onDelete: (itemId: string) => void;
  size?: string;
}) {
  // GAP-28: hidden (not disabled) unless there's an opened window to apply
  // and the pack isn't already open — a button that would only ever no-op
  // is noise on every other row.
  const canMarkOpened = item.useWithinDaysOpened != null && item.useWithinDaysOpened > 0 && !item.openedAt;
  // refs for dialog triggers so the mobile menu can open them without
  // rendering the dialogs inside the menu popup (which would unmount them
  // as the menu closes).
  const editRef = React.useRef<HTMLButtonElement | null>(null);
  const deleteRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <div className="flex items-center gap-1">
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
      <Link
        href={`/dashboard/inventory/items/${item.id}`}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), size, "text-muted-foreground hover:text-primary hidden sm:inline-flex")}
        aria-label={format(dict.detailsAriaLabel, { name: item.name })}
        title={dict.details}
      >
        <Info className="size-3.5" />
      </Link>
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
          <DropdownMenuItem onClick={() => onMarkEmpty(item, true)}>
            {dict.markEmptyAndAddToList}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Hidden programmatic triggers for the edit & delete dialogs (used by mobile menu) */}
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
        trigger={<button ref={editRef} className="sr-only" />}
      />
      <ConfirmDialog
        trigger={<button ref={deleteRef} className="sr-only" />}
        title={format(dict.confirmDelete.title, { name: item.name })}
        description={dict.confirmDelete.description}
        cancelLabel={dict.confirmDelete.cancel}
        confirmLabel={dict.confirmDelete.confirm}
        pendingLabel={dict.confirmDelete.confirming}
        onConfirm={() => onDelete(item.id)}
      />

      {/* Desktop visible edit & delete */}
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
            className={cn(size, "text-muted-foreground hover:text-primary hidden sm:inline-flex")}
            aria-label={dict.editAriaLabel}
          >
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      <ConfirmDialog
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className={cn(size, "text-muted-foreground hover:text-destructive hidden sm:inline-flex")}
            disabled={isPending}
            aria-label={dict.deleteAriaLabel}
          >
            <Trash2 className="size-3.5" />
          </Button>
        }
        title={format(dict.confirmDelete.title, { name: item.name })}
        description={dict.confirmDelete.description}
        cancelLabel={dict.confirmDelete.cancel}
        confirmLabel={dict.confirmDelete.confirm}
        pendingLabel={dict.confirmDelete.confirming}
        onConfirm={() => onDelete(item.id)}
      />

      {/* Mobile: collapsed ⋯ menu that opens the actions */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className={cn(size, "sm:hidden")} aria-label={dict.moreActions ?? "More actions"}>
              <Ellipsis className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {canMarkOpened && <DropdownMenuItem onClick={() => onMarkOpened(item)}>{dict.markOpened}</DropdownMenuItem>}
          <DropdownMenuItem render={<Link href={`/dashboard/inventory/items/${item.id}`} prefetch={false} />}>{dict.details}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMarkEmpty(item, false)}>{dict.markEmpty}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMarkEmpty(item, true)}>{dict.markEmptyAndAddToList}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => editRef.current?.click()}>{dict.edit}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => deleteRef.current?.click()}>{dict.delete}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
