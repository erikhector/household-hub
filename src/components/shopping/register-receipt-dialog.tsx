"use client";

// "Register receipt" — the shortcut for when there's no shopping list yet to
// scan a receipt against (see ReceiptScanDialog for the "resolve an existing
// list" flow this complements). Building a list by hand item-by-item just to
// immediately scan a receipt against it is the tedious round trip this
// skips: instead it creates the list *from* the receipt and completes it in
// one step, via registerReceiptAction.
//
// Same hybrid AI-first/OCR-fallback pipeline as ReceiptScanDialog (see its
// top comment for the reasoning): scanReceiptPhotoAction uploads the photo
// to a configured vision provider when one is set, falling back to the
// original client-side Tesseract.js + receipt-parsing.ts pipeline
// (never uploading the photo) when neither GEMINI_API_KEY nor
// ANTHROPIC_API_KEY is configured.
//
// Each reviewed line also gets an inventory-match step, same UX as
// ResolveMappingsDialog: findInventoryMatches (src/lib/item-matching.ts)
// suggests an existing inventory item by fuzzy name similarity, defaulting
// each row to "use existing" (pre-selected) when confident or "create new"
// when not — either can be overridden before applying. registerReceiptAction
// then links to exactly the item the user confirmed (or creates a new one in
// the chosen category) instead of silently re-guessing server-side.

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, ImageUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComboField } from "@/components/inventory/combo-field";
import { ItemCombobox } from "@/components/inventory/item-combobox";
import { registerReceiptAction } from "@/app/dashboard/shopping-list/actions";
import { findInventoryMatches } from "@/lib/item-matching";
import { detectReceiptCurrency, parseReceiptText } from "@/lib/receipt-parsing";
import { scanReceiptPhotoAction } from "@/lib/actions/receipt-scan";
import { fileToResizedDataUrl } from "@/lib/image-resize";
import { HOUSEHOLD_BASE_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type InventoryItemOption = { id: string; name: string; category: string; unit?: string };

type ReviewRow = {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  /** Editable text so the user can correct an OCR misread digit. */
  price: string;
  /** "existing" links this line to an inventory item on apply (matchId);
   * "new" creates a fresh one in `category`. Defaults per-row from a fuzzy
   * name match against the household's inventory, same threshold/algorithm
   * as ResolveMappingsDialog — the user can override either the mode or the
   * suggested match before applying. */
  mode: "existing" | "new";
  matchId: string;
  category: string;
};

type Phase = "idle" | "analyzing" | "reading" | "review" | "applying" | "error";

// A parsed/scanned line only auto-suggests a match above this similarity —
// below it, defaulting to "create new" is safer than confidently linking the
// wrong inventory item (the user can still pick one manually).
const AUTO_MATCH_MIN_SCORE = 0.35;

export function RegisterReceiptDialog({
  inventoryItems,
  units,
  categories,
  dict,
}: {
  inventoryItems: InventoryItemOption[];
  units: string[];
  categories: string[];
  dict: Dictionary["shoppingList"]["registerReceipt"];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>(HOUSEHOLD_BASE_CURRENCY);
  const [listName, setListName] = useState("");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);

  const itemNames = [...new Set(inventoryItems.map((i) => i.name))].sort((a, b) => a.localeCompare(b));
  const namePlaceholder = `${dict.namePlaceholderPrefix} — ${new Date().toLocaleDateString()}`;

  function reset() {
    setPhase("idle");
    setErrorMessage(null);
    setRows([]);
    setListName("");
    setCurrency(HOUSEHOLD_BASE_CURRENCY);
  }

  function buildRows(lines: { name: string; quantity: number; price: number }[]): ReviewRow[] {
    return lines.map((line, index) => {
      const [suggestion] = findInventoryMatches(line.name, inventoryItems, {
        limit: 1,
        minScore: AUTO_MATCH_MIN_SCORE,
      });
      return {
        key: `${index}-${line.name}`,
        name: line.name,
        quantity: String(line.quantity),
        unit: "pcs",
        price: line.price.toFixed(2),
        mode: suggestion ? "existing" : "new",
        matchId: suggestion?.id ?? "",
        category: "",
      };
    });
  }

  function errorMessageFor(code: string | undefined): string {
    switch (code) {
      case "rate_limited":
        return dict.rateLimitedError;
      case "provider_busy":
        return dict.providerBusyError;
      default:
        return dict.analysisFailedError;
    }
  }

  /** OCR + regex fallback (receipt-parsing.ts), used only when no vision
   * provider is configured server-side — see scanReceiptPhotoAction. */
  async function handleFileWithOcr(file: File) {
    setPhase("reading");
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["eng", "swe"]);
      let text: string;
      try {
        const result = await worker.recognize(file);
        text = result.data.text;
      } finally {
        await worker.terminate();
      }

      const lines = parseReceiptText(text);
      if (lines.length === 0) {
        setPhase("error");
        setErrorMessage(dict.noLinesFound);
        return;
      }

      setCurrency(detectReceiptCurrency(text, HOUSEHOLD_BASE_CURRENCY));
      setRows(buildRows(lines));
      setPhase("review");
    } catch {
      setPhase("error");
      setErrorMessage(dict.ocrError);
    }
  }

  async function handleFile(file: File) {
    setPhase("analyzing");
    setErrorMessage(null);

    let dataUrl: string;
    try {
      dataUrl = await fileToResizedDataUrl(file);
    } catch {
      setPhase("error");
      setErrorMessage(dict.ocrError);
      return;
    }

    const result = await scanReceiptPhotoAction(dataUrl);
    if (result.error === "not_configured") {
      await handleFileWithOcr(file);
      return;
    }
    if (result.error) {
      setPhase("error");
      setErrorMessage(errorMessageFor(result.error));
      return;
    }

    const lines = result.lines ?? [];
    if (lines.length === 0) {
      setPhase("error");
      setErrorMessage(dict.noLinesFound);
      return;
    }

    setCurrency(result.currency ?? HOUSEHOLD_BASE_CURRENCY);
    setRows(buildRows(lines));
    setPhase("review");
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  function handleApply() {
    const items = rows
      .map((row) => ({
        name: row.name.trim(),
        quantity: Number(row.quantity),
        unit: row.unit.trim() || "pcs",
        price: Number(row.price),
        // A row left in "existing" mode without a picked match still needs
        // to end up somewhere on apply — falling through to "create new"
        // rather than silently dropping the line, same invariant as
        // ResolveMappingsDialog's own apply just applied to this dialog's
        // no-skip-the-whole-line rows.
        ...(row.mode === "existing" && row.matchId
          ? { inventoryItemId: row.matchId }
          : { newItemCategory: row.category.trim() }),
      }))
      .filter(
        (item) =>
          item.name.length > 0 &&
          Number.isFinite(item.quantity) &&
          item.quantity > 0 &&
          Number.isFinite(item.price) &&
          item.price > 0,
      );

    if (items.length === 0) {
      setErrorMessage(dict.noItemsError);
      return;
    }

    setPhase("applying");
    setErrorMessage(null);
    void (async () => {
      const result = await registerReceiptAction(listName.trim() || undefined, currency, items);
      if (result.error) {
        setPhase("review");
        setErrorMessage(result.error);
        return;
      }
      const amountLabel = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(result.totalAmount ?? 0);
      toast.success(
        format(dict.appliedToast, {
          count: result.itemsAdded ?? 0,
          amount: `${amountLabel} ${currency}`,
        }),
      );
      if (result.unresolvedNotice) toast.info(result.unresolvedNotice);
      setOpen(false);
      if (result.listId) router.push(`/dashboard/shopping-list/${result.listId}`);
    })();
  }

  function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      reset();
      setOpen(true);
      void handleFile(file);
    }
  }

  return (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFileSelected}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileSelected}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="outline">
              <Camera className="size-4" />
              {dict.button}
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => cameraInputRef.current?.click()}>
            <Camera className="size-4" />
            {dict.takePhoto}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => libraryInputRef.current?.click()}>
            <ImageUp className="size-4" />
            {dict.choosePhoto}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dict.dialogTitle}</DialogTitle>
          </DialogHeader>

          {phase === "analyzing" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              {dict.analyzing}
            </div>
          )}

          {phase === "reading" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              {dict.reading}
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-destructive">{errorMessage}</p>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="outline">{dict.tryAgain}</Button>} />
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => cameraInputRef.current?.click()}>
                    <Camera className="size-4" />
                    {dict.takePhoto}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => libraryInputRef.current?.click()}>
                    <ImageUp className="size-4" />
                    {dict.choosePhoto}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {(phase === "review" || phase === "applying") && (
            <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
              <p className="text-sm text-muted-foreground">{dict.reviewSubtitle}</p>

              <div className="flex flex-col gap-2">
                <Label htmlFor="register-receipt-name">{dict.nameLabel}</Label>
                <Input
                  id="register-receipt-name"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  placeholder={namePlaceholder}
                  maxLength={120}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="register-receipt-currency">{dict.currencyLabel}</Label>
                <Select value={currency} onValueChange={(v) => setCurrency(String(v))}>
                  <SelectTrigger id="register-receipt-currency" className="w-32">
                    <SelectValue>{(v: string) => v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                {rows.map((row) => {
                  const suggestions = findInventoryMatches(row.name, inventoryItems);
                  const suggestedIds = new Set(suggestions.map((s) => s.id));
                  const otherItems = [...inventoryItems]
                    .filter((i) => !suggestedIds.has(i.id))
                    .sort((a, b) => a.name.localeCompare(b.name));
                  const orderedItems = [...suggestions, ...otherItems];
                  return (
                  <div key={row.key} className="flex flex-col gap-2 rounded-md border p-2">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`${row.key}-name`} className="text-xs">
                        {dict.nameLabel}
                      </Label>
                      <div className="flex items-center gap-1">
                        <div className="min-w-0 flex-1">
                          <ComboField
                            id={`${row.key}-name`}
                            name="name"
                            items={itemNames}
                            value={row.name}
                            onValueChange={(v) => updateRow(row.key, { name: v })}
                            maxLength={120}
                            dict={dict}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={format(dict.removeAriaLabel, { name: row.name })}
                          onClick={() => removeRow(row.key)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`${row.key}-quantity`} className="text-xs">
                          {dict.quantityLabel}
                        </Label>
                        <Input
                          id={`${row.key}-quantity`}
                          type="number"
                          min={0.01}
                          step="any"
                          value={row.quantity}
                          onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`${row.key}-unit`} className="text-xs">
                          {dict.unitLabel}
                        </Label>
                        <ComboField
                          id={`${row.key}-unit`}
                          name="unit"
                          items={units}
                          value={row.unit}
                          onValueChange={(v) => updateRow(row.key, { unit: v })}
                          maxLength={20}
                          dict={dict}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label htmlFor={`${row.key}-price`} className="text-xs">
                          {dict.priceLabel}
                        </Label>
                        <Input
                          id={`${row.key}-price`}
                          type="number"
                          min={0}
                          step="any"
                          value={row.price}
                          onChange={(e) => updateRow(row.key, { price: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs">{dict.existingItemLabel}</Label>
                        <div className="flex w-fit shrink-0 gap-1 rounded-lg bg-muted p-1">
                          {inventoryItems.length > 0 && (
                            <Button
                              type="button"
                              variant={row.mode === "existing" ? "secondary" : "ghost"}
                              size="sm"
                              onClick={() => updateRow(row.key, { mode: "existing" })}
                            >
                              {dict.useExisting}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant={row.mode === "new" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => updateRow(row.key, { mode: "new" })}
                          >
                            {dict.createNew}
                          </Button>
                        </div>
                      </div>

                      {row.mode === "existing" && inventoryItems.length > 0 && (
                        <ItemCombobox
                          items={orderedItems.map((i) => ({ id: i.id, label: `${i.name} · ${i.category}` }))}
                          value={row.matchId}
                          onValueChange={(v) => updateRow(row.key, { matchId: v })}
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
                            id={`${row.key}-new-category`}
                            name="newCategory"
                            items={categories}
                            value={row.category}
                            onValueChange={(v) => updateRow(row.key, { category: v })}
                            placeholder={dict.newItemCategoryPlaceholder}
                            maxLength={60}
                            dict={dict}
                          />
                        </>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>

              {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={phase === "applying"}
            >
              {dict.cancel}
            </Button>
            {(phase === "review" || phase === "applying") && (
              <Button
                type="button"
                onClick={handleApply}
                disabled={phase === "applying" || rows.length === 0}
              >
                {phase === "applying" ? dict.applying : dict.apply}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
