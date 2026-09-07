"use client";

// "Scan receipt" — take a photo of a paper receipt and use it to mark
// multiple shopping-list items purchased (with a price) in one go, instead
// of checking them off and pricing them one at a time. See REQUIREMENTS.md
// / the household budget's Cost analyzer for why estimatedPrice matters:
// it's what feeds PriceHistory and therefore the household's spend
// tracking.
//
// OCR runs entirely client-side with Tesseract.js (dynamically imported so
// it never bloats the initial bundle) — the receipt photo itself is never
// uploaded anywhere, only the extracted text/numbers ever reach the server
// (applyReceiptScanAction), same privacy stance as the barcode scanner
// (src/components/shared/barcode-scanner.tsx). Parsing (which lines look
// like priced items) and currency detection are pure functions in
// receipt-parsing.ts, unit-tested there; this component is just the
// review/confirm UI wrapped around them.

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyReceiptScanAction } from "@/app/dashboard/shopping-list/actions";
import { findInventoryMatches } from "@/lib/item-matching";
import { detectReceiptCurrency, parseReceiptText, type ParsedReceiptLine } from "@/lib/receipt-parsing";
import { HOUSEHOLD_BASE_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type PendingItem = { id: string; name: string };

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

type Phase = "idle" | "reading" | "review" | "applying" | "error";

const SKIP_VALUE = "__skip__";
// A parsed line only auto-suggests a match above this similarity — below
// it, defaulting to "skip" is safer than confidently linking the wrong
// item (the user can still pick one manually).
const AUTO_MATCH_MIN_SCORE = 0.35;

export function ReceiptScanDialog({
  listId,
  pendingItems,
  dict,
}: {
  listId: string;
  pendingItems: PendingItem[];
  dict: Dictionary["shoppingList"]["receiptScan"];
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>(HOUSEHOLD_BASE_CURRENCY);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setPhase("idle");
    setErrorMessage(null);
    setRows([]);
    setCurrency(HOUSEHOLD_BASE_CURRENCY);
  }

  function buildRows(lines: ParsedReceiptLine[]): ReviewRow[] {
    return lines.map((line, index) => {
      const [suggestion] = findInventoryMatches(line.name, pendingItems, {
        limit: 1,
        minScore: AUTO_MATCH_MIN_SCORE,
      });
      return {
        key: `${index}-${line.rawLine}`,
        name: line.name,
        quantity: line.quantity,
        price: line.price.toFixed(2),
        matchId: suggestion?.id ?? SKIP_VALUE,
      };
    });
  }

  async function handleFile(file: File) {
    setPhase("reading");
    setErrorMessage(null);
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

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
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

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            reset();
            setOpen(true);
            void handleFile(file);
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={pendingItems.length === 0}
        onClick={() => fileInputRef.current?.click()}
      >
        <Camera className="size-4" />
        {dict.scanButton}
      </Button>

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

          {phase === "reading" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              {dict.reading}
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-destructive">{errorMessage}</p>
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                {dict.tryAgain}
              </Button>
            </div>
          )}

          {(phase === "review" || phase === "applying") && (
            <div className="flex flex-col gap-4">
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

              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {rows.map((row) => (
                  <div
                    key={row.key}
                    className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={row.name}>
                        {row.name}
                      </p>
                      {row.quantity !== 1 && (
                        <p className="text-xs text-muted-foreground">
                          {format(dict.qtyLabel, { qty: row.quantity })}
                        </p>
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
                    <Select
                      value={row.matchId}
                      onValueChange={(v) => updateRow(row.key, { matchId: String(v) })}
                    >
                      <SelectTrigger className="w-full sm:w-48" aria-label={dict.matchLabel}>
                        <SelectValue>
                          {(v: string) =>
                            v === SKIP_VALUE
                              ? dict.skipOption
                              : (pendingItems.find((i) => i.id === v)?.name ?? v)
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP_VALUE}>{dict.skipOption}</SelectItem>
                        {pendingItems.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
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
