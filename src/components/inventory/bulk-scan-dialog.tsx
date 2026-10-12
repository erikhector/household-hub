"use client";

import { useId, useRef, useState, type ReactElement } from "react";
import { Camera, CameraOff, Loader2, ScanLine, X } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { ComboField } from "@/components/inventory/combo-field";
import { bulkCreateInventoryItemsAction } from "@/app/dashboard/inventory/actions";
import { lookupBarcodeAction } from "@/lib/actions/barcode";
import { useBarcodeCamera } from "@/components/shared/use-barcode-camera";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// How long the queue ignores detections after a hit —
// long enough that the same can/box still in frame isn't immediately
// re-added, short enough that moving to the next item doesn't feel like a
// wait. The user can also just move the item out of frame sooner.
const COOLDOWN_MS = 1400;

type Step = "scan" | "review";

// `category` is Open Food Facts' suggestion for the product (AUTO-2), used
// only when the review step's shared category is left blank.
type QueuedScan = { key: string; barcode: string; name: string; quantity: string; category: string | null };

export function BulkScanDialog({
  dict,
  barcodeDict,
  categories,
  locations,
  trigger,
}: {
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  categories: string[];
  locations: string[];
  trigger: ReactElement;
}) {
  const t = dict.bulkScan;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("scan");
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idPrefix = useId();

  const cooldownUntilRef = useRef(0);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setStep("scan");
      setQueue([]);
      setCategory("");
      setLocation("");
      cooldownUntilRef.current = 0;
    }
  };

  const handleDetected = async (barcode: string) => {
    if (Date.now() < cooldownUntilRef.current) return;
    cooldownUntilRef.current = Date.now() + COOLDOWN_MS;

    let addedName = "";
    let becameQuantity = 1;
    setQueue((prev) => {
      const idx = prev.findIndex((q) => q.barcode === barcode);
      if (idx >= 0) {
        const next = [...prev];
        const nextQuantity = (Number(next[idx].quantity) || 0) + 1;
        next[idx] = { ...next[idx], quantity: String(nextQuantity) };
        addedName = next[idx].name || barcode;
        becameQuantity = nextQuantity;
        return next;
      }
      return [...prev, { key: `${barcode}-${Date.now()}`, barcode, name: "", quantity: "1", category: null }];
    });

    const result = await lookupBarcodeAction(barcode);
    if (result.name) {
      addedName = result.name;
      setQueue((prev) =>
        prev.map((q) =>
          q.barcode === barcode && !q.name ? { ...q, name: result.name ?? "", category: result.category ?? null } : q,
        ),
      );
    }
    toast.success(
      becameQuantity > 1
        ? format(t.scannedAgainFlash, { name: addedName || barcode, count: becameQuantity })
        : format(t.scannedFlash, { name: addedName || barcode }),
    );
  };

  // The camera runs only on the scanning step — see useBarcodeCamera. The
  // cooldown above (rather than the stock scan's "wait until it leaves the
  // frame" guard) is deliberate here: holding a second identical can up is
  // how the queue counts ×2.
  const { phase, errorMessage, videoRef } = useBarcodeCamera({
    active: open && step === "scan",
    dict: barcodeDict,
    onDetected: handleDetected,
  });

  const updateRow = (key: string, patch: Partial<QueuedScan>) => {
    setQueue((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeRow = (key: string) => {
    setQueue((prev) => prev.filter((row) => row.key !== key));
  };

  const handleDone = () => {
    // Leaving the scanning step turns the camera off (useBarcodeCamera's
    // `active` goes false).
    setStep("review");
  };

  const handleBackToScanning = () => {
    setStep("scan");
  };

  const handleAddAll = async () => {
    if (queue.some((row) => !row.name.trim())) {
      toast.error(t.nameRequiredError);
      return;
    }
    setSubmitting(true);
    const result = await bulkCreateInventoryItemsAction(
      queue.map((row) => ({
        name: row.name.trim(),
        quantity: Number(row.quantity) || 0,
        unit: "pcs",
        category: row.category ?? undefined,
        // Remembered on the created item (AUTO-6), so a later stock scan
        // of the same product resolves straight to it.
        barcode: row.barcode,
      })),
      { category: category.trim() || undefined, location: location.trim() || undefined },
    );
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    const added = result.added ?? 0;
    if (added > 0) toast.success(format(plural(added, t.addedToast), { count: added }));
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{step === "scan" ? t.dialogTitle : t.reviewTitle}</DialogTitle>
        </DialogHeader>

        {step === "scan" && (
          <div className="flex flex-col gap-3">
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
            </div>
            {phase === "scanning" && <p className="text-center text-sm text-muted-foreground">{t.instructions}</p>}

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {queue.length > 0
                    ? format(
                        plural(
                          queue.reduce((n, r) => n + (Number(r.quantity) || 0), 0),
                          t.queuedCount,
                        ),
                        {
                          count: queue.reduce((n, r) => n + (Number(r.quantity) || 0), 0),
                        },
                      )
                    : t.queueEmptyHint}
                </span>
              </div>
              {queue.length > 0 && (
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {queue.map((row) => (
                    <li key={row.key} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                      <span className="flex-1 line-clamp-2 break-words sm:line-clamp-1">{row.name || t.namePlaceholder}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">×{row.quantity}</span>
                      <button
                        type="button"
                        aria-label={format(t.removeRowAriaLabel, { name: row.name || row.barcode })}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeRow(row.key)}
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {barcodeDict.cancel}
              </Button>
              <Button type="button" disabled={queue.length === 0} onClick={handleDone}>
                {t.doneScanning}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "review" && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-category`}>{t.sharedCategoryLabel}</Label>
                <ComboField
                  id={`${idPrefix}-category`}
                  name="category"
                  items={categories}
                  value={category}
                  onValueChange={setCategory}
                  placeholder={dict.categoryPlaceholder}
                  maxLength={60}
                  dict={dict}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-location`}>{t.sharedLocationLabel}</Label>
                <ComboField
                  id={`${idPrefix}-location`}
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

            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {queue.map((row) => (
                <li key={row.key} className="flex items-center gap-2">
                  <Input
                    autoComplete="off"
                    value={row.name}
                    onChange={(e) => updateRow(row.key, { name: e.target.value })}
                    placeholder={t.namePlaceholder}
                    maxLength={120}
                    className="flex-1"
                    aria-invalid={!row.name.trim()}
                    aria-label={dict.nameLabel}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                    className="w-16"
                    aria-label={dict.quantityLabel}
                  />
                  <button
                    type="button"
                    aria-label={format(t.removeRowAriaLabel, { name: row.name || row.barcode })}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(row.key)}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>

            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="outline" onClick={handleBackToScanning}>
                <ScanLine className="size-4" />
                {t.backToScanning}
              </Button>
              <Button type="button" disabled={submitting || queue.length === 0} onClick={handleAddAll}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  format(plural(queue.length, t.addAllButton), { count: queue.length })
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
