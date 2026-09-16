"use client";

import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { Camera, CameraOff, Loader2, ScanLine, X } from "lucide-react";
import type { BarcodeDetector as BarcodeDetectorInstance } from "barcode-detector/ponyfill";
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
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;
const DETECT_INTERVAL_MS = 350;
// How long the queue pauses after a hit before it starts decoding again —
// long enough that the same can/box still in frame isn't immediately
// re-added, short enough that moving to the next item doesn't feel like a
// wait. The user can also just move the item out of frame sooner.
const COOLDOWN_MS = 1400;

type Phase = "idle" | "starting" | "scanning" | "error";
type Step = "scan" | "review";

type QueuedScan = { key: string; barcode: string; name: string; quantity: string };

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
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idPrefix = useId();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownUntilRef = useRef(0);

  const stopCamera = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    detectorRef.current = null;
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setStep("scan");
      setQueue([]);
      setCategory("");
      setLocation("");
      setErrorMessage(null);
    }
  };

  // Runs the camera + decode loop whenever the dialog is open and on the
  // scanning step — see barcode-scanner.tsx's BarcodeScannerButton for the
  // original single-shot version this generalizes to a running queue.
  useEffect(() => {
    if (!open || step !== "scan") return;

    let cancelled = false;

    const run = async () => {
      setPhase("starting");
      setErrorMessage(null);

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setPhase("error");
          setErrorMessage(barcodeDict.cameraUnavailable);
        }
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        if (cancelled) return;
        setPhase("error");
        const name = err instanceof DOMException ? err.name : "";
        setErrorMessage(
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? barcodeDict.cameraPermissionDenied
            : barcodeDict.cameraUnavailable,
        );
        return;
      }

      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        for (const track of stream.getTracks()) track.stop();
        streamRef.current = null;
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay can reject even with muted+playsInline; frames still
        // arrive and the decode loop below still runs.
      }

      let detector: BarcodeDetectorInstance;
      try {
        const { BarcodeDetector } = await import("barcode-detector/ponyfill");
        detector = new BarcodeDetector({ formats: [...BARCODE_FORMATS] });
      } catch {
        if (!cancelled) {
          setPhase("error");
          setErrorMessage(barcodeDict.cameraError);
        }
        return;
      }
      if (cancelled) return;
      detectorRef.current = detector;

      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      const canvas = canvasRef.current;

      setPhase("scanning");
      cooldownUntilRef.current = 0;

      let decoding = false;
      intervalRef.current = setInterval(() => {
        if (decoding || Date.now() < cooldownUntilRef.current) return;
        void (async () => {
          const currentVideo = videoRef.current;
          const currentDetector = detectorRef.current;
          if (!currentVideo || !currentDetector) return;
          if (currentVideo.readyState < currentVideo.HAVE_CURRENT_DATA) return;
          if (currentVideo.videoWidth === 0 || currentVideo.videoHeight === 0) return;

          decoding = true;
          try {
            if (canvas.width !== currentVideo.videoWidth || canvas.height !== currentVideo.videoHeight) {
              canvas.width = currentVideo.videoWidth;
              canvas.height = currentVideo.videoHeight;
            }
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(currentVideo, 0, 0, canvas.width, canvas.height);

            try {
              const results = await currentDetector.detect(canvas);
              const barcode = results[0]?.rawValue;
              if (barcode && !cancelled) await handleDetected(barcode);
            } catch {
              // A single failed detect() on one frame isn't fatal.
            }
          } finally {
            decoding = false;
          }
        })();
      }, DETECT_INTERVAL_MS);
    };

    const handleDetected = async (barcode: string) => {
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
        return [...prev, { key: `${barcode}-${Date.now()}`, barcode, name: "", quantity: "1" }];
      });

      const result = await lookupBarcodeAction(barcode);
      if (cancelled) return;
      if (result.name) {
        addedName = result.name;
        setQueue((prev) =>
          prev.map((q) => (q.barcode === barcode && !q.name ? { ...q, name: result.name ?? "" } : q)),
        );
      }
      toast.success(
        becameQuantity > 1
          ? format(t.scannedAgainFlash, { name: addedName || barcode, count: becameQuantity })
          : format(t.scannedFlash, { name: addedName || barcode }),
      );
    };

    void run();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const updateRow = (key: string, patch: Partial<QueuedScan>) => {
    setQueue((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeRow = (key: string) => {
    setQueue((prev) => prev.filter((row) => row.key !== key));
  };

  const handleDone = () => {
    stopCamera();
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
      queue.map((row) => ({ name: row.name.trim(), quantity: Number(row.quantity) || 0, unit: "pcs" })),
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
                      <span className="flex-1 truncate">{row.name || t.namePlaceholder}</span>
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
            <div className="grid grid-cols-2 gap-3">
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
