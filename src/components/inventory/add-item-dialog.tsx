"use client";

import { useActionState, useState } from "react";
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
import { createInventoryItemAction } from "@/app/dashboard/inventory/actions";
import { BarcodeScannerButton, ScannedBarcodeNote, type BarcodeScanResult } from "@/components/shared/barcode-scanner";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const initialState: ActionState = {};

export function AddItemDialog({
  categories,
  locations,
  dict,
  barcodeDict,
}: {
  categories: string[];
  locations: string[];
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setName("");
      setScannedBarcode(null);
    }
  };

  const handleScanResult = ({ barcode, name: scannedName }: BarcodeScanResult) => {
    setScannedBarcode(barcode);
    if (scannedName) setName(scannedName);
  };

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await createInventoryItemAction(prevState, formData);
    if (!result.error) handleOpenChange(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button>{dict.addItem}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.addDialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="name">{dict.nameLabel}</Label>
              <BarcodeScannerButton dict={barcodeDict} onResult={handleScanResult} size="xs" />
            </div>
            <Input
              id="name"
              name="name"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {scannedBarcode && (
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
                defaultValue={1}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="unit">{dict.unitLabel}</Label>
              <Input id="unit" name="unit" defaultValue="pcs" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lowStockThreshold">{dict.lowStockAtLabel}</Label>
              <Input
                id="lowStockThreshold"
                name="lowStockThreshold"
                type="number"
                min={0}
                step="any"
                defaultValue={1}
                required
              />
            </div>
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? dict.adding : dict.addItem}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
