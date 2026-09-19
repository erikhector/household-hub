"use client";

// "Scan receipt" — take a photo of a paper receipt and use it to mark
// multiple shopping-list items purchased (with a price) in one go, instead
// of checking them off and pricing them one at a time. See REQUIREMENTS.md
// / the household budget's Cost analyzer for why estimatedPrice matters:
// it's what feeds PriceHistory and therefore the household's spend
// tracking.
//
// A vision model (scanReceiptPhotoAction, same Gemini/Anthropic chain as
// AiShelfScanDialog) reads the receipt photo directly when a provider key is
// configured — a genuine improvement over pattern-matching printed columns,
// which is what made this feature unreliable across the range of real
// receipt layouts. The photo is uploaded to that third-party API for this
// (never stored). When no provider is configured, this falls back to the
// original fully client-side pipeline — Tesseract.js OCR (dynamically
// imported so it never bloats the initial bundle) followed by the regex
// heuristics in receipt-parsing.ts — so receipt scanning still works
// without any AI setup, just less reliably. Either path ends at the same
// review rows; only the extracted name/quantity/price ever reach the server
// (applyReceiptScanAction), never the photo itself in the OCR fallback.

import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Camera, ImageUp, Loader2, Plus } from "lucide-react";
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
import { applyReceiptScanAction, quickAddShoppingListItemAction } from "@/app/dashboard/shopping-list/actions";
import { findInventoryMatches } from "@/lib/item-matching";
import { detectReceiptCurrency, parseReceiptText } from "@/lib/receipt-parsing";
import { scanReceiptPhotoAction } from "@/lib/actions/receipt-scan";
import { fileToResizedDataUrl } from "@/lib/image-resize";
import { HOUSEHOLD_BASE_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type PendingItem = { id: string; name: string };
type InventoryItemOption = { id: string; name: string; category: string; unit?: string };

type ReviewRow = {
  key: string;
  name: string;
  quantity: number;
  /** Editable text so the user can correct an OCR misread digit — parsed
   * back to a number only when applying. */
  price: string;
  /** A pendingItems id, or SKIP_VALUE to leave this line out entirely. */
  matchId: string;
};

/** Draft fields for the inline "add as new item" form — OCR'd name/quantity
 * are only a starting point, since a misread digit or a garbled product name
 * is common, and auto-mapping can't guess a category or unit at all. */
type NewItemDraft = { name: string; quantity: string; unit: string; category: string };

type Phase = "idle" | "analyzing" | "reading" | "review" | "applying" | "error";

const SKIP_VALUE = "__skip__";
// A parsed line only auto-suggests a match above this similarity — below
// it, defaulting to "skip" is safer than confidently linking the wrong
// item (the user can still pick one manually).
const AUTO_MATCH_MIN_SCORE = 0.35;

export function ReceiptScanDialog({
  listId,
  pendingItems,
  inventoryItems,
  categories,
  units,
  dict,
}: {
  listId: string;
  pendingItems: PendingItem[];
  inventoryItems: InventoryItemOption[];
  categories: string[];
  units: string[];
  dict: Dictionary["shoppingList"]["receiptScan"];
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>(HOUSEHOLD_BASE_CURRENCY);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  // Items created mid-scan via the "add as new item" shortcut below, kept
  // separate from the `pendingItems` prop (which only updates once the
  // parent server component revalidates) so a newly created item shows up
  // in every row's match dropdown immediately.
  const [extraItems, setExtraItems] = useState<PendingItem[]>([]);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  // Which row's inline "add as new item" form is open, and its draft fields
  // — kept separate from ReviewRow since these are only relevant while
  // creating the new item, not once it exists.
  const [newItemDraftKey, setNewItemDraftKey] = useState<string | null>(null);
  const [newItemDraft, setNewItemDraft] = useState<NewItemDraft>({
    name: "",
    quantity: "1",
    unit: "pcs",
    category: "",
  });
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);

  const matchOptions = [...pendingItems, ...extraItems];
  const itemNames = [...new Set(inventoryItems.map((i) => i.name))].sort((a, b) => a.localeCompare(b));

  function reset() {
    setPhase("idle");
    setErrorMessage(null);
    setRows([]);
    setExtraItems([]);
    setAddingKey(null);
    setNewItemDraftKey(null);
    setCurrency(HOUSEHOLD_BASE_CURRENCY);
  }

  function buildRows(lines: { name: string; quantity: number; price: number }[]): ReviewRow[] {
    return lines.map((line, index) => {
      const [suggestion] = findInventoryMatches(line.name, pendingItems, {
        limit: 1,
        minScore: AUTO_MATCH_MIN_SCORE,
      });
      return {
        key: `${index}-${line.name}`,
        name: line.name,
        quantity: line.quantity,
        price: line.price.toFixed(2),
        matchId: suggestion?.id ?? SKIP_VALUE,
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

  function openNewItemDraft(row: ReviewRow) {
    setErrorMessage(null);
    setNewItemDraftKey(row.key);
    setNewItemDraft({ name: row.name, quantity: String(row.quantity), unit: "pcs", category: "" });
  }

  function updateNewItemDraft(patch: Partial<NewItemDraft>) {
    setNewItemDraft((prev) => ({ ...prev, ...patch }));
  }

  async function handleConfirmNewItem(row: ReviewRow) {
    const name = newItemDraft.name.trim();
    const quantity = Number(newItemDraft.quantity);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) return;

    setAddingKey(row.key);
    setErrorMessage(null);
    const result = await quickAddShoppingListItemAction(listId, name, quantity, {
      category: newItemDraft.category,
      unit: newItemDraft.unit,
    });
    setAddingKey(null);
    if (result.error || !result.item) {
      setErrorMessage(result.error ?? dict.addItemError);
      return;
    }
    const newItem = result.item;
    setExtraItems((prev) => [...prev, newItem]);
    updateRow(row.key, { matchId: newItem.id, name, quantity });
    setNewItemDraftKey(null);
  }

  function handleApply() {
    const matches = rows
      .filter((row) => row.matchId !== SKIP_VALUE)
      .map((row) => ({ shoppingListItemId: row.matchId, price: Number(row.price) }))
      .filter((m) => Number.isFinite(m.price) && m.price > 0);

    if (matches.length === 0) {
      setErrorMessage(dict.noMatchesError);
      return;
    }

    setPhase("applying");
    setErrorMessage(null);
    void (async () => {
      const result = await applyReceiptScanAction(listId, currency, matches);
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
          count: result.itemsUpdated ?? 0,
          amount: `${amountLabel} ${currency}`,
        }),
      );
      setOpen(false);
    })();
  }

  const matchedCount = rows.filter((row) => row.matchId !== SKIP_VALUE).length;

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
      {/* Two inputs, not one: a `capture` attribute steers some mobile
          browsers straight into the camera app and skips the OS's own
          photo-library chooser, so one input can't offer both "take a new
          photo" and "pick an existing one". */}
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
            <Button type="button" variant="outline" disabled={pendingItems.length === 0}>
              <Camera className="size-4" />
              {dict.scanButton}
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
                <Label htmlFor="receipt-currency">{dict.currencyLabel}</Label>
                <Select value={currency} onValueChange={(v) => setCurrency(String(v))}>
                  <SelectTrigger id="receipt-currency" className="w-32">
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
                  const isUnmatched = row.matchId === SKIP_VALUE;
                  const isAdding = addingKey === row.key;
                  const isDraftOpen = newItemDraftKey === row.key;
                  return (
                    <div key={row.key} className="flex flex-col gap-2 rounded-md border p-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={row.name}>
                            {row.name}
                          </p>
                          {row.quantity !== 1 && (
                            <p className="text-xs text-muted-foreground">
                              {format(dict.qtyLabel, { qty: row.quantity })}
                            </p>
                          )}
                          {isUnmatched && !isDraftOpen && (
                            <p className="text-xs text-muted-foreground">{dict.noMatchHint}</p>
                          )}
                        </div>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={row.price}
                          onChange={(e) => updateRow(row.key, { price: e.target.value })}
                          className="w-24 shrink-0"
                          aria-label={dict.priceLabel}
                        />
                        <div className="w-full sm:w-48">
                          <ItemCombobox
                            items={[
                              { id: SKIP_VALUE, label: dict.skipOption },
                              ...matchOptions.map((item) => ({ id: item.id, label: item.name })),
                            ]}
                            value={row.matchId}
                            onValueChange={(v) => updateRow(row.key, { matchId: v })}
                            ariaLabel={dict.matchLabel}
                            emptyMessage={dict.matchNoResults}
                          />
                        </div>
                        {isUnmatched && !isDraftOpen && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0"
                            onClick={() => openNewItemDraft(row)}
                            title={format(dict.addAsNewItem, { name: row.name })}
                          >
                            <Plus className="size-4" />
                            {dict.addButton}
                          </Button>
                        )}
                      </div>

                      {isDraftOpen && (
                        <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <Label htmlFor={`${row.key}-new-name`} className="text-xs">
                                {dict.newItemNameLabel}
                              </Label>
                              <ComboField
                                id={`${row.key}-new-name`}
                                name="name"
                                items={itemNames}
                                value={newItemDraft.name}
                                onValueChange={(v) => updateNewItemDraft({ name: v })}
                                maxLength={120}
                                dict={dict}
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <Label htmlFor={`${row.key}-new-quantity`} className="text-xs">
                                {dict.newItemQuantityLabel}
                              </Label>
                              <Input
                                id={`${row.key}-new-quantity`}
                                type="number"
                                min={0.01}
                                step="any"
                                value={newItemDraft.quantity}
                                onChange={(e) => updateNewItemDraft({ quantity: e.target.value })}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <Label htmlFor={`${row.key}-new-unit`} className="text-xs">
                                {dict.newItemUnitLabel}
                              </Label>
                              <ComboField
                                id={`${row.key}-new-unit`}
                                name="unit"
                                items={units}
                                value={newItemDraft.unit}
                                onValueChange={(v) => updateNewItemDraft({ unit: v })}
                                maxLength={20}
                                dict={dict}
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <Label htmlFor={`${row.key}-new-category`} className="text-xs">
                                {dict.newItemCategoryLabel}
                              </Label>
                              <ComboField
                                id={`${row.key}-new-category`}
                                name="category"
                                items={categories}
                                value={newItemDraft.category}
                                onValueChange={(v) => updateNewItemDraft({ category: v })}
                                placeholder={dict.newItemCategoryPlaceholder}
                                maxLength={60}
                                dict={dict}
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isAdding}
                              onClick={() => setNewItemDraftKey(null)}
                            >
                              {dict.cancel}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={isAdding || !newItemDraft.name.trim()}
                              onClick={() => void handleConfirmNewItem(row)}
                            >
                              {isAdding && <Loader2 className="size-4 animate-spin" />}
                              {isAdding ? dict.addingItem : dict.confirmAddItem}
                            </Button>
                          </div>
                        </div>
                      )}
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
                disabled={phase === "applying" || matchedCount === 0}
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
