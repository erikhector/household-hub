"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setShoppingListItemCategoryAction } from "@/app/dashboard/shopping-list/item-actions";
import { format } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// Same cap as the server's setItemCategorySchema and the inventory form.
const MAX_CATEGORY_LENGTH = 60;

/**
 * The tappable category chip on a linked shopping-list row (AUTO-2b): shows
 * the linked InventoryItem's category, and one tap opens a menu of the
 * household's existing categories to re-file it — the in-place way to
 * correct an auto-category guess. "New category…" opens a one-field dialog
 * instead of an input inside the menu, since Base UI's menu typeahead would
 * swallow keystrokes. The change applies immediately with an "Undo" on the
 * toast rather than a confirm step (BACKLOG.md's "undo over confirm").
 */
export function CategoryChip({
  itemId,
  itemName,
  category,
  categories,
  disabled,
  dict,
}: {
  itemId: string;
  itemName: string;
  category: string;
  categories: string[];
  disabled?: boolean;
  dict: Dictionary["shoppingList"]["categoryChip"];
}) {
  const [isPending, startTransition] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [newValue, setNewValue] = useState("");

  // The row's own category is always offered (and checked), even if the
  // page's household-wide list somehow didn't include it.
  const options = categories.includes(category) ? categories : [...categories, category].sort();

  const apply = (next: string, previous: string) => {
    startTransition(async () => {
      const result = await setShoppingListItemCategoryAction(itemId, next);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(format(dict.movedToast, { name: itemName, category: next }), {
        action: {
          label: dict.undo,
          onClick: () =>
            startTransition(async () => {
              const undo = await setShoppingListItemCategoryAction(itemId, previous);
              if (undo.error) toast.error(undo.error);
            }),
        },
      });
    });
  };

  const submitNew = () => {
    const trimmed = newValue.trim();
    if (!trimmed) return;
    setNewOpen(false);
    setNewValue("");
    if (trimmed !== category) apply(trimmed, category);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={disabled || isPending}
              aria-label={format(dict.ariaLabel, { name: itemName, category })}
              className={cn(
                "inline-flex h-6 max-sm:h-11 pointer-coarse:h-11 max-w-28 shrink-0 items-center rounded-full border px-2 text-xs text-muted-foreground transition-colors",
                "hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                "disabled:pointer-events-none disabled:opacity-50 sm:max-w-40",
              )}
            >
              <span className="line-clamp-2 break-words sm:line-clamp-1">{category}</span>
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuRadioGroup
            value={category}
            onValueChange={(value: string) => {
              if (value !== category) apply(value, category);
            }}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {option}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNewOpen(true)}>
            <Plus />
            {dict.newCategory}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitNew();
            }}
          >
            <DialogHeader>
              <DialogTitle>{format(dict.newCategoryTitle, { name: itemName })}</DialogTitle>
            </DialogHeader>
            <Input
              autoComplete="off"
              enterKeyHint="done"
              autoFocus
              aria-label={dict.newCategoryLabel}
              placeholder={dict.newCategoryPlaceholder}
              maxLength={MAX_CATEGORY_LENGTH}
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>
                {dict.cancel}
              </Button>
              <Button type="submit" disabled={!newValue.trim()}>
                {dict.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
