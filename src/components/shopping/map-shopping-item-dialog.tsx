"use client";

import { useMemo, useState, useTransition, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "@/app/dashboard/shopping-list/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type InventoryItemOption = { id: string; name: string; category: string };

export function MapShoppingItemDialog({
  item,
  inventoryItems,
  dict,
  trigger,
}: {
  item: { id: string; name: string };
  inventoryItems: InventoryItemOption[];
  dict: Dictionary["shoppingList"]["mapItem"];
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () => findInventoryMatches(item.name, inventoryItems),
    [item.name, inventoryItems],
  );
  const suggestedIds = new Set(suggestions.map((s) => s.id));
  const otherItems = [...inventoryItems]
    .filter((i) => !suggestedIds.has(i.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const orderedItems = [...suggestions, ...otherItems];

  const [mode, setMode] = useState<"existing" | "new">(
    inventoryItems.length > 0 ? "existing" : "new",
  );
  const [selectedId, setSelectedId] = useState(orderedItems[0]?.id ?? "");
  const [newCategory, setNewCategory] = useState("");

  function resetState() {
    setMode(inventoryItems.length > 0 ? "existing" : "new");
    setSelectedId(orderedItems[0]?.id ?? "");
    setNewCategory("");
    setError(null);
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result =
        mode === "existing"
          ? await linkShoppingListItemAction(item.id, selectedId)
          : await createInventoryItemFromShoppingListItemAction(item.id, newCategory);
      if (result.error) {
        setError(result.error);
      } else {
        setOpen(false);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetState();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(dict.title, { name: item.name })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {inventoryItems.length > 0 && (
            <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
              <Button
                type="button"
                variant={mode === "existing" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMode("existing")}
              >
                {dict.chooseExisting}
              </Button>
              <Button
                type="button"
                variant={mode === "new" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMode("new")}
              >
                {dict.createNew}
              </Button>
            </div>
          )}

          {mode === "existing" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="map-existing-item">{dict.existingItemLabel}</Label>
              <Select name="inventoryItemId" value={selectedId} onValueChange={(v) => setSelectedId(String(v))}>
                <SelectTrigger id="map-existing-item" className="w-full">
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
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {inventoryItems.length === 0 && (
                <p className="text-xs text-muted-foreground">{dict.noInventoryItems}</p>
              )}
              <Label htmlFor="map-new-category">{dict.newItemCategoryLabel}</Label>
              <Input
                id="map-new-category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={dict.newItemCategoryPlaceholder}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {dict.cancel}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={pending || (mode === "existing" && !selectedId)}
          >
            {pending ? dict.saving : dict.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
