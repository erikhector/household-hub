"use client";

import { useEffect, useRef, useState } from "react";
import type { BarcodeDetector as BarcodeDetectorInstance } from "barcode-detector/ponyfill";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// The barcode formats grocery/retail packaging actually carries — no QR/2D
// formats, this is inventory/shopping entry, not a generic scanner.
const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

const DETECT_INTERVAL_MS = 350;

export type BarcodeCameraPhase = "idle" | "starting" | "scanning" | "error";

/**
 * The continuous camera + decode loop behind the multi-scan dialogs (the
 * scan queue, BulkScanDialog, and AUTO-6's StockScanDialog): opens the rear
 * camera while `active`, decodes frames client-side (no frame or image ever
 * leaves the device — see REQUIREMENTS.md's "Barcode scanning"), and hands
 * *every* detection to `onDetected`, even a repeat of the same code — the
 * caller decides what a repeat means (the queue counts it after a
 * cooldown, the stock scan ignores it until the code has left the frame —
 * which is also why there's no "pause": a caller waiting on the user keeps
 * receiving sightings, so a product still held up to the lens afterwards
 * isn't mistaken for a fresh scan).
 *
 * `onDetected` is read through a ref, so it can close over fresh state
 * without restarting the camera. Its promise is awaited inside the tick,
 * which means a slow server round trip naturally holds back the next
 * decode instead of letting scans overlap.
 *
 * BarcodeScannerButton keeps its own single-shot copy of this loop: it
 * stops the camera on the first hit, which is a different lifecycle.
 */
export function useBarcodeCamera({
  active,
  dict,
  onDetected,
}: {
  active: boolean;
  dict: Dictionary["barcodeScanner"];
  onDetected: (barcode: string) => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<BarcodeCameraPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  });

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (interval !== null) clearInterval(interval);
      interval = null;
      if (stream) for (const track of stream.getTracks()) track.stop();
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

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

      let opened: MediaStream;
      try {
        // Capped resolution: the ponyfill decodes in ZXing's exhaustive
        // "tryHarder" mode on every frame, so an uncapped feed only makes
        // each tick slower for a barcode a few inches from the lens.
        opened = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
        for (const track of opened.getTracks()) track.stop();
        return;
      }
      stream = opened;

      const video = videoRef.current;
      if (!video) {
        stop();
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
          setErrorMessage(dict.cameraError);
        }
        return;
      }
      if (cancelled) return;

      const canvas = document.createElement("canvas");
      setPhase("scanning");

      // Guards against overlapping ticks: a decode (plus the awaited
      // onDetected) can take longer than DETECT_INTERVAL_MS.
      let busy = false;
      interval = setInterval(() => {
        if (busy) return;
        const currentVideo = videoRef.current;
        if (!currentVideo || currentVideo.readyState < currentVideo.HAVE_CURRENT_DATA) return;
        if (currentVideo.videoWidth === 0 || currentVideo.videoHeight === 0) return;

        busy = true;
        void (async () => {
          try {
            // Resizing a canvas reallocates its buffer even at the same
            // size, so only touch it when the video's dimensions change.
            if (canvas.width !== currentVideo.videoWidth || canvas.height !== currentVideo.videoHeight) {
              canvas.width = currentVideo.videoWidth;
              canvas.height = currentVideo.videoHeight;
            }
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(currentVideo, 0, 0, canvas.width, canvas.height);
            let barcode: string | undefined;
            try {
              barcode = (await detector.detect(canvas))[0]?.rawValue;
            } catch {
              // One failed frame isn't fatal — try again next tick.
            }
            if (barcode && !cancelled) await onDetectedRef.current(barcode);
          } finally {
            busy = false;
          }
        })();
      }, DETECT_INTERVAL_MS);
    };

    void run();

    return () => {
      cancelled = true;
      stop();
      setPhase("idle");
    };
    // `dict` is a stable server-provided prop; restarting the camera on its
    // identity would only flash the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { phase, errorMessage, videoRef };
}
