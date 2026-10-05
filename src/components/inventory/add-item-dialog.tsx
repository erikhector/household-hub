"use client";

import { useActionState, useRef, useState, type ReactElement } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ComboField } from "@/components/inventory/combo-field";
import { createInventoryItemAction, updateInventoryItemAction } from "@/app/dashboard/inventory/actions";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import type { AutoAddedItem } from "@/lib/shopping/default-list";
import { BarcodeScannerButton, ScannedBarcodeNote, type BarcodeScanResult } from "@/components/shared/barcode-scanner";
import type { HouseholdMemberOption, InventoryItemRow } from "@/components/inventory/inventory-table-utils";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";

const initialState: ActionState = {};

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
  aiCategoryFallbackEnabled = false,
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
  /** AUTO-2b(a): whether a Gemini/Anthropic key is configured, so the
   * create-mode category hint can disclose the AI fallback — never shown
   * on a deployment where it can't actually run (see AiShelfScanDialog's
   * own "configured" prop for the same gating pattern). */
  aiCategoryFallbackEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [location, setLocation] = useState(item?.location ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "pcs");
  // AUTO-7: -1 is Grocy's "never expires" convention (see
  // shelf-life.ts) — checking this hides/disables the date field and
  // permanently opts the item out of both manual and estimated expiry
  // tracking, for things like salt or rice that never meaningfully expire.
  const [neverExpires, setNeverExpires] = useState(item?.shelfLifeDays === -1);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  // Tracks which of the two submit buttons was pressed, and how many items
  // have gone in via "save & add another" so far this time the dialog is
  // open — set on click (below), read once the action settles.
  const keepOpenRef = useRef(false);
  const [sessionAddedCount, setSessionAddedCount] = useState(0);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setName(item?.name ?? "");
      setCategory(item?.category ?? "");
      setLocation(item?.location ?? "");
      setUnit(item?.unit ?? "pcs");
      setNeverExpires(item?.shelfLifeDays === -1);
      setScannedBarcode(null);
      setSessionAddedCount(0);
    }
  };

  const handleScanResult = ({ barcode, name: scannedName, category: scannedCategory }: BarcodeScanResult) => {
    setScannedBarcode(barcode);
    if (scannedName) setName(scannedName);
    // Only fills a blank field — a category the user already picked (or kept
    // from the previous "add another") wins over the product database's.
    if (scannedCategory) setCategory((current) => current || scannedCategory);
  };

  const action: (
    prevState: ActionState,
    formData: FormData,
  ) => Promise<ActionState & { autoAdded?: AutoAddedItem[] }> =
    mode === "create" ? createInventoryItemAction : updateInventoryItemAction;
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await action(prevState, formData);
    if (result.error) return result;
    // Only the edit form can lower an existing item's quantity, so only it
    // ever comes back with an AUTO-8 auto-add to offer Undo for.
    showAutoAddedToast(result.autoAdded, dict.autoAdd);

    if (keepOpenRef.current) {
      // Category/location/unit/quantity/threshold stay exactly as they are —
      // most bulk sessions are one category/location at a time (a whole
      // pantry shelf, a drawer of tools), so re-picking them per item is the
      // cost this button exists to remove. Only the name (and any scanned
      // barcode note) resets, and focus goes back to it immediately.
      setName("");
      setScannedBarcode(null);
      setSessionAddedCount((count) => count + 1);
      nameInputRef.current?.focus();
    } else {
      handleOpenChange(false);
    }
    return {};
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
          {/* Remembered on the new item (AUTO-6) so the next scan of this
              product resolves straight to it — see createInventoryItemAction. */}
          {mode === "create" && scannedBarcode && <input type="hidden" name="barcode" value={scannedBarcode} />}
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              {mode === "create" && (
                <p className="text-xs text-muted-foreground">
                  {dict.categoryHint} {aiCategoryFallbackEnabled && dict.categoryHintAi}
                </p>
              )}
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
          {/* Phones: a short quantity column beside a unit that takes the
              rest of the row; "low stock at" wraps under quantity. Three
              equal columns left the unit combobox 5 px of text. */}
          <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="quantity">{dict.quantityLabel}</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                inputMode="decimal"
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
                inputMode="decimal"
                min={0}
                step="any"
                defaultValue={item?.lowStockThreshold ?? 1}
                required
              />
            </div>
          </div>
          {/* MATCH-6: changing the unit of an item with stock or saved
              conversions happens on its page ("Change unit…"), which is
              also where its conversions and recipes are. */}
          {mode === "edit" && item && (
            <Link
              href={`/dashboard/inventory/items/${item.id}`}
              className="-mt-2 w-fit text-xs text-primary underline-offset-4 hover:underline"
            >
              {dict.unitsAndDetailsLink}
            </Link>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="expiresAt">{dict.expiresAtLabel}</Label>
            <Input
              id="expiresAt"
              name="expiresAt"
              type="date"
              disabled={neverExpires}
              // Left in place (not cleared) while disabled — unchecking
              // "doesn't expire" shouldn't lose whatever date was there, and
              // a disabled input's value isn't submitted anyway.
              defaultValue={item?.expiresAt ? item.expiresAt.toISOString().slice(0, 10) : ""}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                name="neverExpires"
                checked={neverExpires}
                onChange={(e) => setNeverExpires(e.target.checked)}
              />
              {dict.neverExpiresLabel}
            </label>
          </div>
          {/* GAP-28: optional, blank = not tracked. Disabled alongside the
              date for a "doesn't expire" item, which the action also saves
              as null — an opened clock makes no sense on salt. */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="useWithinDaysOpened">{dict.useWithinDaysOpenedLabel}</Label>
            <Input
              id="useWithinDaysOpened"
              name="useWithinDaysOpened"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              disabled={neverExpires}
              defaultValue={item?.useWithinDaysOpened ?? ""}
            />
            <p className="text-xs text-muted-foreground">{dict.useWithinDaysOpenedHint}</p>
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          {sessionAddedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {format(plural(sessionAddedCount, dict.sessionAddedCount), { count: sessionAddedCount })}
            </p>
          )}
          <DialogFooter>
            {mode === "create" && (
              <Button
                type="submit"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  keepOpenRef.current = true;
                }}
              >
                {pending ? dict.adding : dict.saveAndAddAnother}
              </Button>
            )}
            <Button
              type="submit"
              disabled={pending}
              onClick={() => {
                keepOpenRef.current = false;
              }}
            >
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
