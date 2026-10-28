"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { Camera, CameraOff, Loader2, ShoppingCart, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogHandle,
} from "@/components/ui/dialog";
import { ItemCombobox } from "@/components/inventory/item-combobox";
import { useBarcodeCamera } from "@/components/shared/use-barcode-camera";
import { markItemEmptyAction } from "@/app/dashboard/inventory/actions";
import {
  createItemFromBarcodeAction,
  linkBarcodeAction,
  scanStockChangeAction,
  undoScanStockChangeAction,
  type ScannedItem,
  type StockScanResult,
} from "@/lib/actions/barcode";
import { acceptScan, normalizeBarcode, type RepeatGuardState } from "@/lib/barcode";
import { formatQuantity } from "@/lib/format-quantity";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { cn } from "@/lib/utils";
import { useUnitLabel } from "@/components/units-provider";

type Mode = 1 | -1;

// One row of this session's scan log — the dialog's stand-in for a toast's
// Undo. A toast's action button can't be used here: tapping anything
// outside a modal Base UI dialog counts as an outside press and closes it,
// camera and all, which is exactly what continuous scanning must not do.
type LogEntry = {
  key: string;
  item: ScannedItem;
  appliedDelta: number;
  mode: Mode;
  undone: boolean;
  addedToList: boolean;
};

type UnknownScan = { barcode: string; name: string; category: string | null; found: boolean };

// Keeps the log to what fits on a phone screen without the dialog turning
// into a scroll of its own; older rows are still saved, just not undoable
// from here.
const LOG_LIMIT = 8;

/**
 * AUTO-6's "Scan" mode: the camera stays open and every scan of a
 * remembered barcode changes that item's stock by one straight away —
 * "Put away" +1 or "Used up" −1 — with Undo on the row it adds to the log
 * (and "…and add to list" once a "Used up" scan reaches 0). An unknown
 * barcode stops to ask, once: "Add as new item" with Open Food Facts' name,
 * or "This is…" to link it to an item the household already has. Either
 * way the code is remembered, so the next scan of it is one step.
 *
 * Never blocks manual entry: with no camera (or permission denied) the
 * typed-number field below still runs the exact same flow, and the rest of
 * the inventory page is untouched either way.
 */
export function StockScanDialog({
  dict,
  barcodeDict,
  items,
  handle,
}: {
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  /** The household's items, for the "This is…" picker. */
  items: { id: string; name: string }[];
  // Opened through this handle by a trigger that stays in the page's own chunk, so
  // this dialog loads on first use (PERF-26, ui/lazy-dialog.tsx).
  handle: DialogHandle;
}) {
  const unitLabel = useUnitLabel();
  const t = dict.stockScan;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(1);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [unknown, setUnknown] = useState<UnknownScan | null>(null);
  const [linkItemId, setLinkItemId] = useState("");
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [isPending, startTransition] = useTransition();
  const guardRef = useRef<RepeatGuardState>({ code: null, lastSeenAt: 0 });
  // Read by handleCode, which can run from inside the camera loop between
  // renders — the ref, not the state, is the source of truth for "is an
  // unknown code already waiting on the user?".
  const unknownRef = useRef<UnknownScan | null>(null);

  const showUnknown = (next: UnknownScan | null) => {
    unknownRef.current = next;
    setUnknown(next);
    setLinkItemId("");
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setLog([]);
      showUnknown(null);
      setManual("");
      setManualError(null);
      guardRef.current = { code: null, lastSeenAt: 0 };
    }
  };

  const recordApplied = (result: Extract<StockScanResult, { kind: "applied" }>, message: string) => {
    setLog((prev) =>
      [
        {
          key: `${result.item.id}-${Date.now()}`,
          item: result.item,
          appliedDelta: result.appliedDelta,
          mode,
          undone: false,
          addedToList: false,
        },
        ...prev,
      ].slice(0, LOG_LIMIT),
    );
    toast.success(message, { duration: 2000 });
  };

  const handleResult = (result: StockScanResult) => {
    if (result.kind === "error") {
      toast.error(result.error);
      return;
    }
    if (result.kind === "unknown") {
      showUnknown({
        barcode: result.barcode,
        name: result.name ?? "",
        category: result.category,
        found: Boolean(result.name),
      });
      return;
    }
    recordApplied(
      result,
      format(t.appliedToast, {
        name: result.item.name,
        quantity: formatQuantity(result.item.quantity),
        unit: result.item.unit,
      }),
    );
  };

  const handleCode = async (code: string) => {
    setScanning(true);
    try {
      handleResult(await scanStockChangeAction(code, mode));
    } finally {
      setScanning(false);
    }
  };

  const handleDetected = async (raw: string) => {
    const code = normalizeBarcode(raw);
    if (!code) return;
    // Every sighting goes through the guard, even while an unknown code is
    // waiting, so a product still held up to the lens after the user
    // answers isn't counted again.
    const { accept, next } = acceptScan(guardRef.current, code, Date.now());
    guardRef.current = next;
    if (!accept || unknownRef.current) return;
    await handleCode(code);
  };

  const { phase, errorMessage, videoRef } = useBarcodeCamera({
    active: open,
    dict: barcodeDict,
    onDetected: handleDetected,
  });

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeBarcode(manual);
    if (!code) {
      setManualError(t.invalidBarcode);
      return;
    }
    setManualError(null);
    setManual("");
    showUnknown(null);
    // A typed number is always deliberate, so it skips the repeat guard.
    void handleCode(code);
  };

  const handleAddAsNew = () => {
    if (!unknown) return;
    startTransition(async () => {
      const result = await createItemFromBarcodeAction({
        barcode: unknown.barcode,
        name: unknown.name,
        category: unknown.category,
        delta: mode,
      });
      if (result.kind === "applied") {
        showUnknown(null);
        recordApplied(result, format(t.addedToast, { name: result.item.name }));
      } else if (result.kind === "error") {
        toast.error(result.error);
      }
    });
  };

  const handleLink = () => {
    if (!unknown || !linkItemId) return;
    startTransition(async () => {
      const result = await linkBarcodeAction(unknown.barcode, linkItemId, mode);
      if (result.kind === "applied") {
        showUnknown(null);
        recordApplied(result, format(t.linkedToast, { name: result.item.name }));
      } else if (result.kind === "error") {
        toast.error(result.error);
      }
    });
  };

  const patchEntry = (key: string, patch: Partial<LogEntry>) => {
    setLog((prev) => prev.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  };

  const handleUndo = (entry: LogEntry) => {
    // Marked undone up front so a double tap can't reverse the scan twice.
    patchEntry(entry.key, { undone: true });
    startTransition(async () => {
      const result = await undoScanStockChangeAction(entry.item.id, entry.appliedDelta);
      if (result.error || !result.item) {
        patchEntry(entry.key, { undone: false });
        toast.error(result.error ?? "");
        return;
      }
      patchEntry(entry.key, { item: result.item });
      toast.success(
        format(t.undoneToast, {
          name: result.item.name,
          quantity: formatQuantity(result.item.quantity),
          unit: result.item.unit,
        }),
        { duration: 2000 },
      );
    });
  };

  const handleAddToList = (entry: LogEntry) => {
    patchEntry(entry.key, { addedToList: true });
    startTransition(async () => {
      // The item is already at 0, so this is just markItemEmptyAction's
      // list half — same list choice and dedupe as "Mark empty".
      const result = await markItemEmptyAction(entry.item.id, true);
      if (result.error) {
        patchEntry(entry.key, { addedToList: false });
        toast.error(result.error);
        return;
      }
      if (result.listName) {
        toast.success(format(t.addedToListToast, { name: entry.item.name, list: result.listName }), {
          duration: 2000,
        });
      }
    });
  };

  const itemOptions = items.map((item) => ({ id: item.id, label: item.name }));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t.modeLabel}</span>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={t.modeLabel}>
              {([1, -1] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={mode === value ? "default" : "outline"}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {value === 1 ? t.putAway : t.usedUp}
                </Button>
              ))}
            </div>
          </div>

          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
            <video
              ref={videoRef}
              muted
              playsInline
              className={phase === "scanning" ? "size-full object-cover" : "hidden"}
            />
            {phase !== "scanning" && (
              <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                {phase === "error" ? <CameraOff className="size-6" /> : <Camera className="size-6 animate-pulse" />}
                {phase === "starting" && barcodeDict.starting}
                {phase === "error" && errorMessage}
              </div>
            )}
            {scanning && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          {phase === "scanning" && (
            <p className="text-center text-sm text-muted-foreground">
              {unknown ? t.pausedHint : t.instructions}
            </p>
          )}

          <form onSubmit={handleManualSubmit} className="flex flex-col gap-1.5">
            <Label htmlFor="stock-scan-manual" className="text-xs text-muted-foreground">
              {t.manualLabel}
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="stock-scan-manual"
                inputMode="numeric"
                autoComplete="off"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder={t.manualPlaceholder}
                maxLength={20}
                aria-invalid={Boolean(manualError)}
              />
              <Button type="submit" variant="outline" disabled={!manual.trim() || scanning}>
                {t.manualSubmit}
              </Button>
            </div>
            {manualError && <p className="text-xs text-destructive">{manualError}</p>}
          </form>

          {unknown && (
            <div className="flex flex-col gap-2.5 rounded-md border p-3" aria-live="polite">
              <p className="text-sm font-medium">{format(t.unknownTitle, { barcode: unknown.barcode })}</p>
              <p className="text-xs text-muted-foreground">{unknown.found ? t.unknownFound : t.unknownNotFound}</p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="stock-scan-new-name">{t.newItemNameLabel}</Label>
                <div className="flex gap-1.5">
                  <Input
                    autoComplete="off"
                    enterKeyHint="done"
                    id="stock-scan-new-name"
                    value={unknown.name}
                    onChange={(e) => {
                      const next = { ...unknown, name: e.target.value };
                      unknownRef.current = next;
                      setUnknown(next);
                    }}
                    maxLength={120}
                  />
                  <Button type="button" disabled={!unknown.name.trim() || isPending} onClick={handleAddAsNew}>
                    {t.addAsNew}
                  </Button>
                </div>
              </div>
              {itemOptions.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="stock-scan-link">{t.thisIsLabel}</Label>
                  <div className="flex gap-1.5">
                    <div className="min-w-0 flex-1">
                      <ItemCombobox
                        id="stock-scan-link"
                        items={itemOptions}
                        value={linkItemId}
                        onValueChange={setLinkItemId}
                        placeholder={t.thisIsPlaceholder}
                        emptyMessage={t.thisIsEmpty}
                        ariaLabel={t.thisIsLabel}
                      />
                    </div>
                    <Button type="button" variant="outline" disabled={!linkItemId || isPending} onClick={handleLink}>
                      {t.link}
                    </Button>
                  </div>
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => showUnknown(null)}
              >
                {t.skip}
              </Button>
            </div>
          )}

          {log.length === 0 ? (
            !unknown && <p className="text-xs text-muted-foreground">{t.logEmptyHint}</p>
          ) : (
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {log.map((entry) => (
                <li
                  key={entry.key}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                    entry.undone && "text-muted-foreground line-through",
                  )}
                >
                  <span className="min-w-0 flex-1 line-clamp-2 break-words sm:line-clamp-1">{entry.item.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {entry.appliedDelta > 0 ? "+" : entry.appliedDelta < 0 ? "−" : "±"}
                    {formatQuantity(Math.abs(entry.appliedDelta))} ·{" "}
                    {format(t.logRow, { quantity: formatQuantity(entry.item.quantity), unit: unitLabel(entry.item.unit) })}
                  </span>
                  {entry.mode === -1 && entry.item.quantity === 0 && !entry.undone && !entry.addedToList && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={isPending}
                      onClick={() => handleAddToList(entry)}
                    >
                      <ShoppingCart />
                      {t.addToList}
                    </Button>
                  )}
                  {entry.appliedDelta !== 0 && !entry.undone && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={isPending}
                      onClick={() => handleUndo(entry)}
                    >
                      <Undo2 />
                      {t.undo}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t.done}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
