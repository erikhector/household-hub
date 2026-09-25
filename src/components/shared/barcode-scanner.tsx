"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2, ScanLine } from "lucide-react";
import type { BarcodeDetector as BarcodeDetectorInstance } from "barcode-detector/ponyfill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { lookupBarcodeAction } from "@/lib/actions/barcode";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type BarcodeScannerDict = Dictionary["barcodeScanner"];

export type BarcodeScanResult = {
  barcode: string;
  /** Product name from Open Food Facts, or null on a lookup miss/failure. */
  name: string | null;
  /** Localized auto-category from the product's Open Food Facts tags, or
   * null when there's none to suggest. */
  category: string | null;
};

// The barcode formats an item's grocery/retail packaging actually carries —
// no QR/2D formats, this is inventory/shopping entry, not a generic scanner.
const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

const DETECT_INTERVAL_MS = 350;

type Phase = "idle" | "starting" | "scanning" | "looking-up" | "error";

/**
 * A "Scan barcode" button that opens the device camera, decodes a barcode
 * client-side (never sending any frame/image anywhere — see
 * REQUIREMENTS.md's "Barcode scanning" section), looks up the product name
 * via Open Food Facts, and reports the result through `onResult`. Shared by
 * the inventory add-item form and the shopping list ad-hoc-add form.
 *
 * Fully additive: on any failure (no camera, permission denied, no
 * `BarcodeDetector` support, a lookup miss) this just shows an inline
 * message and lets the user close the dialog — the manual entry form this
 * button sits next to is never touched or blocked by it.
 */
export function BarcodeScannerButton({
  dict,
  onResult,
  onDetected,
  disabled,
  size = "default",
  label,
}: {
  dict: BarcodeScannerDict;
  onResult?: (result: BarcodeScanResult) => void;
  /** Replaces the default Open Food Facts lookup + `onResult` with the
   * caller's own handling of the decoded code — the shopping list's smart
   * add line uses it to resolve a remembered barcode (AUTO-6) first. The
   * dialog shows "looking up" until it settles, then closes. */
  onDetected?: (barcode: string) => Promise<void>;
  disabled?: boolean;
  /** "icon" renders just the scan icon, with `label` (or the default
   * "Scan barcode") as its accessible name. */
  size?: "default" | "sm" | "xs" | "icon";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Starts the camera + decode loop whenever the dialog opens, and always
  // tears it down when it closes or the component unmounts — a `cancelled`
  // flag guards against setting state after the user closes the dialog
  // while a `getUserMedia()`/import() promise is still pending.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const run = async () => {
      setPhase("starting");
      setErrorMessage(null);

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setPhase("error");
          setErrorMessage(dict.cameraUnavailable);
        }
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Capping resolution matters a lot here: the decoder below runs in
          // ZXing's exhaustive "tryHarder" mode on every frame (it's baked
          // into the barcode-detector ponyfill, not something we can turn
          // off), so an uncapped 1080p+ camera feed makes each tick far
          // slower than it needs to be for a barcode a few inches from the
          // lens. 1280px is plenty of resolution for that distance.
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch (err) {
        if (cancelled) return;
        setPhase("error");
        const name = err instanceof DOMException ? err.name : "";
        setErrorMessage(
          name === "NotAllowedError" || name === "PermissionDeniedError"
            ? dict.cameraPermissionDenied
            : dict.cameraUnavailable,
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
        // Autoplay can reject in some browsers even with muted+playsInline;
        // the decode loop below still runs once frames start arriving.
      }

      let detector: BarcodeDetectorInstance;
      try {
        const { BarcodeDetector } = await import("barcode-detector/ponyfill");
        detector = new BarcodeDetector({ formats: [...BARCODE_FORMATS] });
      } catch {
        if (!cancelled) {
          setPhase("error");
          setErrorMessage(dict.cameraError);
        }
        return;
      }
      if (cancelled) return;
      detectorRef.current = detector;

      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      const canvas = canvasRef.current;

      setPhase("scanning");

      // Guards against overlapping detect() calls: a decode can take longer
      // than DETECT_INTERVAL_MS on slower devices, and since detect() runs
      // in ZXing's exhaustive mode, letting ticks pile up on top of each
      // other only makes every one of them slower.
      let decoding = false;

      intervalRef.current = setInterval(() => {
        if (decoding) return;
        void (async () => {
          const currentVideo = videoRef.current;
          const currentDetector = detectorRef.current;
          if (!currentVideo || !currentDetector) return;
          if (currentVideo.readyState < currentVideo.HAVE_CURRENT_DATA) return;
          if (currentVideo.videoWidth === 0 || currentVideo.videoHeight === 0) return;

          decoding = true;
          try {
            // Setting canvas.width/height clears and reallocates its backing
            // buffer even when the value is unchanged, so only touch it when
            // the video's actual dimensions differ from last time.
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
              if (barcode && !cancelled) {
                await handleDetected(barcode);
              }
            } catch {
              // A single failed detect() on one frame isn't fatal — just
              // skip this tick and try again on the next one.
            }
          } finally {
            decoding = false;
          }
        })();
      }, DETECT_INTERVAL_MS);
    };

    const handleDetected = async (barcode: string) => {
      if (cancelled) return;
      stopCamera();
      setPhase("looking-up");
      if (onDetected) {
        await onDetected(barcode);
        if (cancelled) return;
        setOpen(false);
        return;
      }
      const result = await lookupBarcodeAction(barcode);
      if (cancelled) return;
      onResult?.({ barcode, name: result.name, category: result.category ?? null });
      setOpen(false);
    };

    void run();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={size === "icon" ? (label ?? dict.scanButton) : undefined}
      >
        <ScanLine className="size-4" />
        {size !== "icon" && (label ?? dict.scanButton)}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{dict.dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
              {/* Always mounted while the dialog is open so the ref is
                  attached before getUserMedia() resolves; hidden visually
                  once we're not actively scanning. */}
              <video
                ref={videoRef}
                muted
                playsInline
                className={
                  phase === "scanning" || phase === "looking-up"
                    ? "size-full object-cover"
                    : "hidden"
                }
              />
              {phase !== "scanning" && phase !== "looking-up" && (
                <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                  {phase === "error" ? (
                    <CameraOff className="size-6" />
                  ) : (
                    <Camera className="size-6 animate-pulse" />
                  )}
                  {phase === "starting" && dict.starting}
                  {phase === "error" && errorMessage}
                </div>
              )}
              {phase === "looking-up" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  {dict.lookingUp}
                </div>
              )}
            </div>
            {phase === "scanning" && (
              <p className="text-center text-sm text-muted-foreground">{dict.instructions}</p>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {dict.cancel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A small "Scanned barcode: 7311041052452" reference line, shown once a
 * scan has resolved (whether or not the lookup found a product name) so the
 * user can still search/enter the item manually with the number in hand. */
export function ScannedBarcodeNote({
  barcode,
  dict,
}: {
  barcode: string;
  dict: BarcodeScannerDict;
}) {
  return <p className="text-xs text-muted-foreground">{format(dict.scannedLabel, { barcode })}</p>;
}
