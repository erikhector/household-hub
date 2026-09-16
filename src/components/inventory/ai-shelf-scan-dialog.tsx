"use client";

// "Scan a shelf" (beta) — take a photo of a shelf/fridge/cupboard and let a
// vision model guess what's on it, following the same "scan, review,
// confirm" shape as BulkScanDialog (barcode) and ReceiptScanDialog (OCR)
// alongside it. The one real difference from those two: this genuinely
// uploads the photo to a third-party API — Gemini or Anthropic, whichever
// scanShelfPhotoAction finds configured (there's no client-side vision
// model to run this against instead) — the dialog says so up front, and
// the photo is never written to the database, only the reviewed
// name/quantity guesses are (via bulkCreateInventoryItemsAction, same as
// every other bulk-add path in this file's siblings).

import { useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { toast } from "sonner";
import { Camera, ImageUp, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ComboField } from "@/components/inventory/combo-field";
import { bulkCreateInventoryItemsAction } from "@/app/dashboard/inventory/actions";
import { scanShelfPhotoAction } from "@/lib/actions/inventory-scan";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type Phase = "idle" | "analyzing" | "review" | "applying" | "error";
type Row = { key: string; name: string; quantity: number };

// The vision API charges (and performs) roughly the same either way past
// this edge length, so downscaling here keeps the upload small without
// throwing away anything the model could actually use.
const MAX_IMAGE_EDGE = 1568;
const JPEG_QUALITY = 0.85;

async function fileToResizedDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

export function AiShelfScanDialog({
  dict,
  categories,
  locations,
  configured,
  trigger,
}: {
  dict: Dictionary["inventory"];
  categories: string[];
  locations: string[];
  /** Whether GEMINI_API_KEY or ANTHROPIC_API_KEY is set server-side — see src/lib/actions/inventory-scan.ts. */
  configured: boolean;
  trigger: ReactElement;
}) {
  const t = dict.aiShelfScan;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);

  function errorMessageFor(code: string | undefined): string {
    switch (code) {
      case "not_configured":
        return t.notConfiguredError;
      case "rate_limited":
        return t.rateLimitedError;
      case "provider_busy":
        return t.providerBusyError;
      default:
        return t.analysisFailedError;
    }
  }

  function reset() {
    setPhase(configured ? "idle" : "error");
    setErrorMessage(configured ? null : t.notConfiguredError);
    setPhotoPreview(null);
    setRows([]);
    setCategory("");
    setLocation("");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) reset();
  }

  async function handleFile(file: File) {
    setPhase("analyzing");
    setErrorMessage(null);
    let dataUrl: string;
    try {
      dataUrl = await fileToResizedDataUrl(file);
    } catch {
      setPhase("error");
      setErrorMessage(t.analysisFailedError);
      return;
    }
    setPhotoPreview(dataUrl);

    const result = await scanShelfPhotoAction(dataUrl);
    if (result.error) {
      setPhase("error");
      setErrorMessage(errorMessageFor(result.error));
      return;
    }
    const items = result.items ?? [];
    if (items.length === 0) {
      setPhase("error");
      setErrorMessage(t.noItemsFoundError);
      return;
    }
    setRows(items.map((item, index) => ({ key: `${index}-${item.name}`, name: item.name, quantity: item.quantity })));
    setPhase("review");
  }

  function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handleFile(file);
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  async function handleAddAll() {
    if (rows.some((row) => !row.name.trim())) {
      setErrorMessage(dict.bulkScan.nameRequiredError);
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    const result = await bulkCreateInventoryItemsAction(
      rows.map((row) => ({ name: row.name.trim(), quantity: row.quantity, unit: "pcs" })),
      { category: category.trim() || undefined, location: location.trim() || undefined },
    );
    setSubmitting(false);
    if (result.error) {
      setErrorMessage(result.error);
      return;
    }
    const added = result.added ?? 0;
    if (added > 0) toast.success(format(plural(added, dict.bulkScan.addedToast), { count: added }));
    handleOpenChange(false);
  }

  const pickerMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline">{t.tryAgain}</Button>} />
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => cameraInputRef.current?.click()}>
          <Camera className="size-4" />
          {t.takePhoto}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => libraryInputRef.current?.click()}>
          <ImageUp className="size-4" />
          {t.choosePhoto}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {/* Two inputs, not one — `capture` steers mobile browsers straight into
          the camera app, which then can't also offer the photo library. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFileSelected}
      />
      <input ref={libraryInputRef} type="file" accept="image/*" className="hidden" onChange={onFileSelected} />

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger render={trigger} />
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {t.dialogTitle}
              <Badge variant="secondary">{t.betaBadge}</Badge>
            </DialogTitle>
          </DialogHeader>

          {phase === "idle" && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{t.subtitle}</p>
              <div className="flex justify-center gap-2">
                <Button type="button" onClick={() => cameraInputRef.current?.click()}>
                  <Camera className="size-4" />
                  {t.takePhoto}
                </Button>
                <Button type="button" variant="outline" onClick={() => libraryInputRef.current?.click()}>
                  <ImageUp className="size-4" />
                  {t.choosePhoto}
                </Button>
              </div>
            </div>
          )}

          {phase === "analyzing" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
              {photoPreview && (
                // A data: URL from the user's own camera, not a static asset — next/image's
                // optimizer has nothing to do with a URL like this.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoPreview} alt="" className="max-h-40 rounded-md object-contain" />
              )}
              <Loader2 className="size-6 animate-spin" />
              <Sparkles className="sr-only" aria-hidden />
              {t.analyzing}
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-destructive">{errorMessage}</p>
              {configured && pickerMenu}
            </div>
          )}

          {(phase === "review" || phase === "applying") && (
            <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
              <p className="text-sm text-muted-foreground">{t.reviewSubtitle}</p>
              {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ai-shelf-scan-category">{dict.bulkScan.sharedCategoryLabel}</Label>
                  <ComboField
                    id="ai-shelf-scan-category"
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
                  <Label htmlFor="ai-shelf-scan-location">{dict.bulkScan.sharedLocationLabel}</Label>
                  <ComboField
                    id="ai-shelf-scan-location"
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
                {rows.map((row) => (
                  <li key={row.key} className="flex items-center gap-2">
                    <Input
                      value={row.name}
                      onChange={(e) => updateRow(row.key, { name: e.target.value })}
                      placeholder={dict.bulkScan.namePlaceholder}
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
                      onChange={(e) => updateRow(row.key, { quantity: Number(e.target.value) || 0 })}
                      className="w-16"
                      aria-label={dict.quantityLabel}
                    />
                    <button
                      type="button"
                      aria-label={format(dict.bulkScan.removeRowAriaLabel, { name: row.name })}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(row.key)}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>

              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="outline" onClick={() => reset()}>
                  <Camera className="size-4" />
                  {t.tryAgain}
                </Button>
                <Button type="button" disabled={submitting || rows.length === 0} onClick={handleAddAll}>
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    format(plural(rows.length, dict.bulkScan.addAllButton), { count: rows.length })
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
