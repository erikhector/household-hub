"use client";

import { Ban, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
// InventoryTable) so the mark-empty/edit/delete cluster — and its touch-
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
  onDelete: (itemId: string) => void;
  size?: string;
}) {
  return (
    <div className="flex items-center gap-1">
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
