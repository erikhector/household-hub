"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ComboField } from "@/components/inventory/combo-field";
import { ItemCombobox } from "@/components/inventory/item-combobox";
import { findInventoryMatches } from "@/lib/item-matching";
import { format, plural } from "@/lib/i18n/format";
import {
  resolveShoppingListMappingsAction,
  type MappingResolution,
} from "@/app/dashboard/shopping-list/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type UnresolvedItem = { id: string; name: string };
type InventoryItemOption = { id: string; name: string; category: string };

type RowState = {
  itemId: string;
  name: string;
  mode: "existing" | "new" | "skip";
  selectedId: string;
  newCategory: string;
};

function buildRow(item: UnresolvedItem, inventoryItems: InventoryItemOption[]): RowState {
  const [suggestion] = findInventoryMatches(item.name, inventoryItems, { limit: 1, minScore: 0.35 });
  return {
    itemId: item.id,
    name: item.name,
    mode: suggestion ? "existing" : inventoryItems.length > 0 ? "existing" : "new",
    selectedId: suggestion?.id ?? "",
    newCategory: "",
  };
}

/**
 * Compact review screen for resolving several unlinked shopping-list items
 * at once — the batch counterpart to EditShoppingItemDialog's one-at-a-time
 * link picker, offered once a list has enough unmapped items
 * (BATCH_RESOLVE_THRESHOLD in shopping-list-client.tsx) that clicking into
 * that dialog repeatedly would be tedious. Modeled on ReceiptScanDialog's
 * row-based review UI, minus the price/OCR parts this doesn't need.
 */
export function ResolveMappingsDialog({
  items,
  inventoryItems,
  categories,
  dict,
  triggerLabel,
}: {
  items: UnresolvedItem[];
  inventoryItems: InventoryItemOption[];
  categories: string[];
  dict: Dictionary["shoppingList"]["resolveMappings"];
  triggerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>(() => items.map((item) => buildRow(item, inventoryItems)));

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setRows(items.map((item) => buildRow(item, inventoryItems)));
      setError(null);
    }
  }

  function updateRow(itemId: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((row) => (row.itemId === itemId ? { ...row, ...patch } : row)));
  }

  function handleApply() {
    const resolutions: MappingResolution[] = rows.flatMap((row): MappingResolution[] => {
      if (row.mode === "skip") return [];
      if (row.mode === "existing") {
        return row.selectedId
          ? [{ itemId: row.itemId, kind: "existing", inventoryItemId: row.selectedId }]
          : [];
      }
      return [{ itemId: row.itemId, kind: "new", category: row.newCategory }];
    });

    if (resolutions.length === 0) {
      setOpen(false);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await resolveShoppingListMappingsAction(resolutions);
      if (result.error) {
        setError(result.error);
        return;
      }
      const resolvedCount = result.resolvedCount ?? 0;
      if (resolvedCount > 0) {
        toast.success(format(plural(resolvedCount, dict.appliedToast), { count: resolvedCount }));
      } else {
        toast.error(dict.errorToast);
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button type="button" variant="outline">{triggerLabel}</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dict.dialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
          <div className="flex flex-col gap-2">
            {rows.map((row) => {
              const suggestions = findInventoryMatches(row.name, inventoryItems);
              const suggestedIds = new Set(suggestions.map((s) => s.id));
              const otherItems = [...inventoryItems]
                .filter((i) => !suggestedIds.has(i.id))
                .sort((a, b) => a.name.localeCompare(b.name));
              const orderedItems = [...suggestions, ...otherItems];

              return (
                <div key={row.itemId} className="flex flex-col gap-2 rounded-md border p-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium" title={row.name}>
                      {row.name}
                    </p>
                    <div className="flex w-fit shrink-0 gap-1 rounded-lg bg-muted p-1">
                      {inventoryItems.length > 0 && (
                        <Button
                          type="button"
                          variant={row.mode === "existing" ? "secondary" : "ghost"}
                          size="sm"
                          onClick={() => updateRow(row.itemId, { mode: "existing" })}
                        >
                          {dict.useExisting}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant={row.mode === "new" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => updateRow(row.itemId, { mode: "new" })}
                      >
                        {dict.createNew}
                      </Button>
                      <Button
                        type="button"
                        variant={row.mode === "skip" ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => updateRow(row.itemId, { mode: "skip" })}
                      >
                        {dict.skip}
                      </Button>
                    </div>
                  </div>

                  {row.mode === "existing" && (
                    <ItemCombobox
                      items={orderedItems.map((i) => ({ id: i.id, label: `${i.name} · ${i.category}` }))}
                      value={row.selectedId}
                      onValueChange={(v) => updateRow(row.itemId, { selectedId: v })}
                      ariaLabel={dict.existingItemLabel}
                      emptyMessage={dict.existingItemNoResults}
                    />
                  )}

                  {row.mode === "new" && (
                    <>
                      {inventoryItems.length === 0 && (
                        <p className="text-xs text-muted-foreground">{dict.noInventoryItems}</p>
                      )}
                      <ComboField
                        id={`resolve-${row.itemId}-new-category`}
                        name="newCategory"
                        items={categories}
                        value={row.newCategory}
                        onValueChange={(v) => updateRow(row.itemId, { newCategory: v })}
                        placeholder={dict.newItemCategoryPlaceholder}
                        maxLength={60}
                        dict={dict}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {dict.cancel}
          </Button>
          <Button type="button" onClick={handleApply} disabled={pending}>
            {pending ? dict.applying : dict.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
