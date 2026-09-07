"use client";

import { useActionState, useState, type ReactElement } from "react";
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
import { createInventoryItemAction, updateInventoryItemAction } from "@/app/dashboard/inventory/actions";
import { BarcodeScannerButton, ScannedBarcodeNote, type BarcodeScanResult } from "@/components/shared/barcode-scanner";
import type { InventoryItemRow } from "@/components/inventory/inventory-table";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: ActionState = {};

export function ItemFormDialog({
  mode,
  item,
  categories,
  locations,
  dict,
  barcodeDict,
  trigger,
}: {
  mode: "create" | "edit";
  item?: InventoryItemRow;
  categories: string[];
  locations: string[];
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item?.name ?? "");
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setName(item?.name ?? "");
      setScannedBarcode(null);
    }
  };

  const handleScanResult = ({ barcode, name: scannedName }: BarcodeScanResult) => {
    setScannedBarcode(barcode);
    if (scannedName) setName(scannedName);
  };

  const action = mode === "create" ? createInventoryItemAction : updateInventoryItemAction;
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await action(prevState, formData);
    if (!result.error) handleOpenChange(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? dict.addDialogTitle : dict.editDialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {mode === "edit" && item && <input type="hidden" name="itemId" value={item.id} />}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="name">{dict.nameLabel}</Label>
              {mode === "create" && (
                <BarcodeScannerButton dict={barcodeDict} onResult={handleScanResult} size="xs" />
              )}
            </div>
            <Input
              id="name"
              name="name"
              required
              autoFocus
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {mode === "create" && scannedBarcode && (
              <div className="flex flex-col gap-0.5">
                <ScannedBarcodeNote barcode={scannedBarcode} dict={barcodeDict} />
                {!name && <p className="text-xs text-muted-foreground">{barcodeDict.notFound}</p>}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="category">{dict.categoryLabel}</Label>
              <Input
                id="category"
                name="category"
                required
                maxLength={60}
                defaultValue={item?.category}
                placeholder={dict.categoryPlaceholder}
                list="category-options"
                autoComplete="off"
              />
              <datalist id="category-options">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="location">{dict.locationLabel}</Label>
              <Input
                id="location"
                name="location"
                maxLength={120}
                defaultValue={item?.location ?? undefined}
                placeholder={dict.locationPlaceholder}
                list="location-options"
                autoComplete="off"
              />
              <datalist id="location-options">
                {locations.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="quantity">{dict.quantityLabel}</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={0}
                step="any"
                defaultValue={item?.quantity ?? 1}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="unit">{dict.unitLabel}</Label>
              <Input id="unit" name="unit" maxLength={20} defaultValue={item?.unit ?? "pcs"} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lowStockThreshold">{dict.lowStockAtLabel}</Label>
              <Input
                id="lowStockThreshold"
                name="lowStockThreshold"
                type="number"
                min={0}
                step="any"
                defaultValue={item?.lowStockThreshold ?? 1}
                required
              />
            </div>
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending
                ? mode === "create"
                  ? dict.adding
                  : dict.saving
                : mode === "create"
                  ? dict.addItem
                  : dict.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
