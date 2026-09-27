"use client";

import Link from "next/link";
import { Ban, Info, PackageOpen, Pencil, Trash2 } from "lucide-react";
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
  return (
    <div className="flex items-center gap-1">
      {canMarkOpened && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(size, "text-muted-foreground hover:text-primary")}
          disabled={isPending}
          aria-label={format(dict.markOpenedAriaLabel, { name: item.name })}
          title={dict.markOpened}
          onClick={() => onMarkOpened(item)}
        >
          <PackageOpen className="size-3.5" />
        </Button>
      )}
      {/* MATCH-6: the item page (recipes using it, units, learned names). */}
      <Link
        href={`/dashboard/inventory/items/${item.id}`}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), size, "text-muted-foreground hover:text-primary")}
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
              className={cn(size, "text-muted-foreground hover:text-warning")}
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
            className={cn(size, "text-muted-foreground hover:text-primary")}
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
            className={cn(size, "text-muted-foreground hover:text-destructive")}
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
    </div>
  );
}
