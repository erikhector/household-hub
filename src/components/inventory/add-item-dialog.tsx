"use client";

import { useActionState, useRef, useState, type ReactElement } from "react";
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
  Autocomplete,
  AutocompleteClear,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteTrigger,
} from "@/components/ui/autocomplete";
import { createInventoryItemAction, updateInventoryItemAction } from "@/app/dashboard/inventory/actions";
import { BarcodeScannerButton, ScannedBarcodeNote, type BarcodeScanResult } from "@/components/shared/barcode-scanner";
import type { HouseholdMemberOption, InventoryItemRow } from "@/components/inventory/inventory-table";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";

const initialState: ActionState = {};

function ComboField({
  id,
  name,
  items,
  value,
  onValueChange,
  placeholder,
  maxLength,
  dict,
}: {
  id: string;
  name: string;
  items: string[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  maxLength: number;
  dict: Dictionary["inventory"];
}) {
  const trimmed = value.trim();
  return (
    <Autocomplete items={items} name={name} value={value} onValueChange={onValueChange}>
      <AutocompleteInputGroup>
        <AutocompleteInput id={id} placeholder={placeholder} maxLength={maxLength} />
        <AutocompleteClear />
        <AutocompleteTrigger />
      </AutocompleteInputGroup>
      <AutocompleteContent>
        <AutocompleteEmpty>
          {trimmed ? format(dict.comboboxAddNew, { value: trimmed }) : dict.comboboxNoMatches}
        </AutocompleteEmpty>
        <AutocompleteList>
          {(option: string) => (
            <AutocompleteItem key={option} value={option}>
              {option}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompleteContent>
    </Autocomplete>
  );
}

export function ItemFormDialog({
  mode,
  item,
  categories,
  locations,
  units,
  members = [],
  locale,
  dict,
  barcodeDict,
  trigger,
}: {
  mode: "create" | "edit";
  item?: InventoryItemRow;
  categories: string[];
  locations: string[];
  units: string[];
  /** Only needed in edit mode, to resolve `item.updatedByUserId` to a name
   * for the "last updated by" line below. */
  members?: HouseholdMemberOption[];
  locale?: Locale;
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [location, setLocation] = useState(item?.location ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "pcs");
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setName(item?.name ?? "");
      setCategory(item?.category ?? "");
      setLocation(item?.location ?? "");
      setUnit(item?.unit ?? "pcs");
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
      <DialogContent
        initialFocus={(interactionType) =>
          interactionType === "touch" ? null : nameInputRef.current
        }
      >
        <DialogHeader>
          <DialogTitle>{mode === "create" ? dict.addDialogTitle : dict.editDialogTitle}</DialogTitle>
        </DialogHeader>
        {mode === "edit" && item && locale && (
          <p className="-mt-2 text-xs text-muted-foreground">
            {(() => {
              const dateLabel = new Intl.DateTimeFormat(locale, {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }).format(item.updatedAt);
              const updaterName = members.find((m) => m.userId === item.updatedByUserId)?.displayName;
              return updaterName
                ? format(dict.lastUpdatedWithUser, { date: dateLabel, name: updaterName })
                : format(dict.lastUpdatedNoUser, { date: dateLabel });
            })()}
          </p>
        )}
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
              ref={nameInputRef}
              id="name"
              name="name"
              required
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
              <ComboField
                id="category"
                name="category"
                items={categories}
                value={category}
                onValueChange={setCategory}
                placeholder={dict.categoryPlaceholder}
                maxLength={60}
                dict={dict}
              />
              {mode === "create" && <p className="text-xs text-muted-foreground">{dict.categoryHint}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="location">{dict.locationLabel}</Label>
              <ComboField
                id="location"
                name="location"
                items={locations}
                value={location}
                onValueChange={setLocation}
                placeholder={dict.locationPlaceholder}
                maxLength={120}
                dict={dict}
              />
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
              <ComboField
                id="unit"
                name="unit"
                items={units}
                value={unit}
                onValueChange={setUnit}
                placeholder={dict.unitPlaceholder}
                maxLength={20}
                dict={dict}
              />
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
