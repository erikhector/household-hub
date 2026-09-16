"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
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
import { ComboField } from "@/components/inventory/combo-field";
import { ItemCombobox } from "@/components/inventory/item-combobox";
import { BarcodeScannerButton, ScannedBarcodeNote, type BarcodeScanResult } from "@/components/shared/barcode-scanner";
import { findInventoryMatches } from "@/lib/item-matching";
import { format } from "@/lib/i18n/format";
import {
  addAdHocItemAction,
  createInventoryItemFromShoppingListItemAction,
  linkShoppingListItemAction,
  unlinkShoppingListItemAction,
  updateShoppingListItemAction,
} from "@/app/dashboard/shopping-list/actions";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type InventoryItemOption = { id: string; name: string; category: string; unit?: string };

type EditableShoppingItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  inventoryItemId: string | null;
};

type ShoppingListDict = Dictionary["shoppingList"];

const initialState: ActionState = {};

/**
 * One component for both creating a new shopping-list item (the "+" button
 * next to the list, see UX_CONSISTENCY_BACKLOG.md item G) and editing an
 * existing one (the pencil icon / "Match item" badge on each row) — merged
 * per item H of that same backlog, which previously lived as two
 * independently written components (AddItemForm/AddItemDialog and
 * EditShoppingItemDialog) that could drift out of sync with each other.
 *
 * Follows ItemFormDialog's (src/components/inventory/add-item-dialog.tsx)
 * `mode`-prop shape, but — unlike Inventory/Recipes, where create and edit
 * share the exact same field set — create here is a compact one-line
 * quick-add (name/quantity/unit + barcode scan, no inventory-link UI) while
 * edit is a fuller dialog that also manages the item's inventory link
 * (matched suggestions, link/unlink, create-new-item). Rather than force
 * those two very different layouts into one shared JSX tree, this keeps
 * each mode's existing fields, copy, validation and server actions exactly
 * as they were, sharing only what's genuinely common: the open/close
 * `Dialog` shell, the name/unit state, and the household-item-name
 * autocomplete list.
 */
export function ShoppingItemFormDialog({
  mode,
  listId,
  item,
  inventoryItems,
  categories = [],
  units,
  dict,
  barcodeDict,
  editAriaLabel,
  matchItemLabel,
}: {
  mode: "create" | "edit";
  /** Required in create mode: the list the new item is added to. */
  listId?: string;
  /** Required in edit mode: the item being edited. */
  item?: EditableShoppingItem;
  inventoryItems: InventoryItemOption[];
  /** Only needed in edit mode, for the "create a new inventory item" category field. */
  categories?: string[];
  units: string[];
  dict: ShoppingListDict;
  /** Required in create mode. */
  barcodeDict?: Dictionary["barcodeScanner"];
  /** Required in edit mode. */
  editAriaLabel?: string;
  /** Required in edit mode. */
  matchItemLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "");

  const itemNames = useMemo(
    () => [...new Set(inventoryItems.map((i) => i.name))].sort((a, b) => a.localeCompare(b)),
    [inventoryItems],
  );

  // --- create-only state -----------------------------------------------
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);

  const handleNameChange = (nextName: string) => {
    setName(nextName);
    if (!unit) {
      const matched = inventoryItems.find(
        (i) => i.name.toLowerCase() === nextName.trim().toLowerCase(),
      );
      if (matched?.unit) setUnit(matched.unit);
    }
  };

  const handleScanResult = ({ barcode, name: scannedName }: BarcodeScanResult) => {
    setScannedBarcode(barcode);
    if (scannedName) setName(scannedName);
  };

  const [state, formAction, addPending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const submittedName = String(formData.get("name") ?? "").trim();
    const result = await addAdHocItemAction(prevState, formData);
    if (!result.error) {
      if (result.autoLinkedName) {
        toast.success(format(dict.autoLinkedName, { name: result.autoLinkedName }));
      } else if (result.needsMapping && submittedName) {
        // Add-time heads-up so the pantry-sync exception is explained the
        // moment the item lands, not only once the list is completed (see
        // unresolvedNotice) — the row's own inline hint (below) is what
        // stays visible for as long as the item is unresolved.
        toast.info(format(dict.needsMappingToast, { name: submittedName }));
      }
      setName("");
      setUnit("");
      setScannedBarcode(null);
      setOpen(false);
    }
    return result;
  }, initialState);

  // --- edit-only state ---------------------------------------------------
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [error, setError] = useState<string | null>(null);
  const [editPending, startTransition] = useTransition();

  const suggestions = useMemo(
    () => findInventoryMatches(item?.name ?? "", inventoryItems),
    [item?.name, inventoryItems],
  );
  const suggestedIds = new Set(suggestions.map((s) => s.id));
  const otherItems = [...inventoryItems]
    .filter((i) => !suggestedIds.has(i.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const orderedItems = [...suggestions, ...otherItems];
  const linkedItem = inventoryItems.find((i) => i.id === item?.inventoryItemId) ?? null;

  const [linkMode, setLinkMode] = useState<"linked" | "existing" | "new">(
    item?.inventoryItemId ? "linked" : inventoryItems.length > 0 ? "existing" : "new",
  );
  const [selectedId, setSelectedId] = useState(item?.inventoryItemId ?? orderedItems[0]?.id ?? "");

  const [newCategory, setNewCategory] = useState("");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    if (mode === "create") {
      setName("");
      setUnit("");
      setScannedBarcode(null);
      return;
    }
    if (!item) return;
    setName(item.name);
    setQuantity(String(item.quantity));
    setUnit(item.unit);
    setLinkMode(item.inventoryItemId ? "linked" : inventoryItems.length > 0 ? "existing" : "new");
    setSelectedId(item.inventoryItemId ?? orderedItems[0]?.id ?? "");
    setNewCategory("");
    setError(null);
  }

  function handleSave() {
    if (!item) return;
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
    if (!item) return;
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
      {mode === "create" ? (
        <DialogTrigger
          render={
            <Button className="gap-1.5">
              <Plus className="size-4" />
              <span className="sr-only sm:not-sr-only">{dict.addItem}</span>
            </Button>
          }
        />
      ) : (
        <>
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
          {item?.inventoryItemId === null && (
            <DialogTrigger
              nativeButton={false}
              render={
                <Badge
                  variant="outline"
                  className="shrink-0 cursor-pointer border-dashed text-warning hover:bg-warning/10"
                >
                  {matchItemLabel}
                </Badge>
              }
            />
          )}
        </>
      )}
      <DialogContent>
        {mode === "create" ? (
          <>
            <DialogHeader>
              <DialogTitle>{dict.addItemDialogTitle}</DialogTitle>
            </DialogHeader>
            <form action={formAction} className="flex flex-col gap-2">
              <input type="hidden" name="listId" value={listId} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-0 flex-1 basis-full flex-col gap-1 sm:basis-auto">
                  <ComboField
                    id="add-item-name"
                    name="name"
                    items={itemNames}
                    value={name}
                    onValueChange={handleNameChange}
                    placeholder={dict.addItemNamePlaceholder}
                    maxLength={120}
                    dict={dict}
                  />
                </div>
                <Input
                  name="quantity"
                  type="number"
                  min={0.01}
                  step="any"
                  defaultValue={1}
                  className="w-20"
                  aria-label={dict.addItemQuantityAriaLabel}
                />
                <div className="w-24">
                  <ComboField
                    id="add-item-unit"
                    name="unit"
                    items={units}
                    value={unit}
                    onValueChange={setUnit}
                    placeholder={dict.addItemUnitPlaceholder}
                    maxLength={20}
                    dict={dict}
                  />
                </div>
                {barcodeDict && <BarcodeScannerButton dict={barcodeDict} onResult={handleScanResult} />}
                <Button type="submit" variant="outline" disabled={addPending}>
                  {addPending ? dict.adding : dict.add}
                </Button>
              </div>
              {scannedBarcode && barcodeDict && (
                <div className="flex flex-col gap-0.5">
                  <ScannedBarcodeNote barcode={scannedBarcode} dict={barcodeDict} />
                  {!name && <p className="text-xs text-muted-foreground">{barcodeDict.notFound}</p>}
                </div>
              )}
              {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            </form>
          </>
        ) : (
          item && (
            <>
              <DialogHeader>
                <DialogTitle>{format(dict.editItem.title, { name: item.name })}</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSave();
                }}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-item-name">{dict.editItem.nameLabel}</Label>
                  <ComboField
                    id="edit-item-name"
                    name="name"
                    items={itemNames}
                    value={name}
                    onValueChange={setName}
                    maxLength={120}
                    dict={dict.editItem}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="edit-item-quantity">{dict.editItem.quantityLabel}</Label>
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
                    <Label htmlFor="edit-item-unit">{dict.editItem.unitLabel}</Label>
                    <ComboField
                      id="edit-item-unit"
                      name="unit"
                      items={units}
                      value={unit}
                      onValueChange={setUnit}
                      placeholder={dict.editItem.unitPlaceholder}
                      maxLength={20}
                      dict={dict.editItem}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <Label>{dict.editItem.linkSectionLabel}</Label>
                  {linkMode === "linked" && linkedItem ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm">
                        {format(dict.editItem.linkedTo, { name: linkedItem.name })}
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setLinkMode("existing")}>
                          {dict.editItem.changeLink}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleUnlink}
                          disabled={editPending}
                        >
                          {dict.editItem.unlink}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">{dict.editItem.notLinkedHint}</p>
                      {inventoryItems.length > 0 && (
                        <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
                          <Button
                            type="button"
                            variant={linkMode === "existing" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setLinkMode("existing")}
                          >
                            {dict.editItem.chooseExisting}
                          </Button>
                          <Button
                            type="button"
                            variant={linkMode === "new" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setLinkMode("new")}
                          >
                            {dict.editItem.createNew}
                          </Button>
                        </div>
                      )}
                      {linkMode === "existing" ? (
                        <ItemCombobox
                          id="edit-item-link"
                          items={orderedItems.map((i) => ({ id: i.id, label: `${i.name} · ${i.category}` }))}
                          value={selectedId}
                          onValueChange={setSelectedId}
                          ariaLabel={dict.editItem.existingItemLabel}
                          emptyMessage={dict.editItem.existingItemNoResults}
                        />
                      ) : (
                        <>
                          {inventoryItems.length === 0 && (
                            <p className="text-xs text-muted-foreground">{dict.editItem.noInventoryItems}</p>
                          )}
                          <ComboField
                            id="edit-item-new-category"
                            name="newCategory"
                            items={categories}
                            value={newCategory}
                            onValueChange={setNewCategory}
                            placeholder={dict.editItem.newItemCategoryPlaceholder}
                            maxLength={60}
                            dict={dict.editItem}
                          />
                        </>
                      )}
                    </>
                  )}
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={editPending}>
                    {dict.editItem.cancel}
                  </Button>
                  <Button
                    type="submit"
                    disabled={editPending || !name.trim() || (linkMode === "existing" && !selectedId)}
                  >
                    {editPending ? dict.editItem.saving : dict.editItem.save}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
