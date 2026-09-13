"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { findInventoryMatches } from "@/lib/item-matching";
import { format } from "@/lib/i18n/format";
import {
  createInventoryItemFromShoppingListItemAction,
  linkShoppingListItemAction,
  unlinkShoppingListItemAction,
  updateShoppingListItemAction,
} from "@/app/dashboard/shopping-list/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type InventoryItemOption = { id: string; name: string; category: string };

type EditableItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  inventoryItemId: string | null;
};

/**
 * One dialog for everything you'd want to change about a shopping-list
 * item: its own fields (name/quantity/unit, via updateShoppingListItemAction)
 * and its inventory link (via linkShoppingListItemAction /
 * createInventoryItemFromShoppingListItemAction / unlinkShoppingListItemAction).
 * Replaces the old MapShoppingItemDialog, which only handled linking —
 * editing fields used to mean delete-and-re-add, which lost
 * addedAutomatically/estimatedPrice and the link in the process.
 *
 * Renders two DialogTriggers sharing one Dialog root (both reset the form
 * state the same way on open): a pencil icon always shown for editable
 * rows, and — only while the item has no inventory link — the amber "needs
 * mapping" badge itself, so either entry point lands in the same place.
 */
export function EditShoppingItemDialog({
  item,
  inventoryItems,
  dict,
  editAriaLabel,
  matchItemLabel,
}: {
  item: EditableItem;
  inventoryItems: InventoryItemOption[];
  dict: Dictionary["shoppingList"]["editItem"];
  editAriaLabel: string;
  matchItemLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unit, setUnit] = useState(item.unit);

  const suggestions = useMemo(
    () => findInventoryMatches(item.name, inventoryItems),
    [item.name, inventoryItems],
  );
  const suggestedIds = new Set(suggestions.map((s) => s.id));
  const otherItems = [...inventoryItems]
    .filter((i) => !suggestedIds.has(i.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const orderedItems = [...suggestions, ...otherItems];
  const linkedItem = inventoryItems.find((i) => i.id === item.inventoryItemId) ?? null;

  const [linkMode, setLinkMode] = useState<"linked" | "existing" | "new">(
    item.inventoryItemId ? "linked" : inventoryItems.length > 0 ? "existing" : "new",
  );
  const [selectedId, setSelectedId] = useState(item.inventoryItemId ?? orderedItems[0]?.id ?? "");
  const [newCategory, setNewCategory] = useState("");

  function resetState() {
    setName(item.name);
    setQuantity(String(item.quantity));
    setUnit(item.unit);
    setLinkMode(item.inventoryItemId ? "linked" : inventoryItems.length > 0 ? "existing" : "new");
    setSelectedId(item.inventoryItemId ?? orderedItems[0]?.id ?? "");
    setNewCategory("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) resetState();
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const fieldsResult = await updateShoppingListItemAction(item.id, {
        name,
        quantity: Number(quantity),
        unit,
      });
      if (fieldsResult.error) {
        setError(fieldsResult.error);
        return;
      }

      let linkResult: { error?: string } = {};
      if (linkMode === "existing" && selectedId && selectedId !== item.inventoryItemId) {
        linkResult = await linkShoppingListItemAction(item.id, selectedId);
      } else if (linkMode === "new") {
        linkResult = await createInventoryItemFromShoppingListItemAction(item.id, newCategory);
      }
      if (linkResult.error) {
        setError(linkResult.error);
        return;
      }

      setOpen(false);
    });
  }

  function handleUnlink() {
    setError(null);
    startTransition(async () => {
      const result = await unlinkShoppingListItemAction(item.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setLinkMode(inventoryItems.length > 0 ? "existing" : "new");
      setSelectedId(orderedItems[0]?.id ?? "");
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={editAriaLabel}
          >
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      {item.inventoryItemId === null && (
        <DialogTrigger
          render={
            <Badge
              variant="outline"
              className="shrink-0 cursor-pointer border-dashed text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
            >
              {matchItemLabel}
            </Badge>
          }
        />
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(dict.title, { name: item.name })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-item-name">{dict.nameLabel}</Label>
            <Input
              id="edit-item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-item-quantity">{dict.quantityLabel}</Label>
              <Input
                id="edit-item-quantity"
                type="number"
                min={0.01}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-item-unit">{dict.unitLabel}</Label>
              <Input
                id="edit-item-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                maxLength={20}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-md border p-3">
            <Label>{dict.linkSectionLabel}</Label>
            {linkMode === "linked" && linkedItem ? (
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm">
                  {format(dict.linkedTo, { name: linkedItem.name })}
                </span>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLinkMode("existing")}>
                    {dict.changeLink}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={handleUnlink} disabled={pending}>
                    {dict.unlink}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{dict.notLinkedHint}</p>
                {inventoryItems.length > 0 && (
                  <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
                    <Button
                      type="button"
                      variant={linkMode === "existing" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setLinkMode("existing")}
                    >
                      {dict.chooseExisting}
                    </Button>
                    <Button
                      type="button"
                      variant={linkMode === "new" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setLinkMode("new")}
                    >
                      {dict.createNew}
                    </Button>
                  </div>
                )}
                {linkMode === "existing" ? (
                  <Select value={selectedId} onValueChange={(v) => setSelectedId(String(v))}>
                    <SelectTrigger id="edit-item-link" className="w-full">
                      <SelectValue>
                        {(v: string) => orderedItems.find((i) => i.id === v)?.name ?? v}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {orderedItems.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name} · {i.category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    {inventoryItems.length === 0 && (
                      <p className="text-xs text-muted-foreground">{dict.noInventoryItems}</p>
                    )}
                    <Input
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder={dict.newItemCategoryPlaceholder}
                      maxLength={60}
                    />
                  </>
                )}
              </>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {dict.cancel}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={pending || !name.trim() || (linkMode === "existing" && !selectedId)}
          >
            {pending ? dict.saving : dict.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
