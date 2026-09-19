// Client-side downscale for a photo about to be uploaded to a vision API —
// shared by every AI photo-scan dialog (AiShelfScanDialog, ReceiptScanDialog,
// RegisterReceiptDialog). Originally lived only in AiShelfScanDialog; pulled
// out once a second/third caller needed the exact same canvas-resize dance.

// The vision API charges (and performs) roughly the same either way past
// this edge length, so downscaling here keeps the upload small without
// throwing away anything the model could actually use.
const MAX_IMAGE_EDGE = 1568;
const JPEG_QUALITY = 0.85;

export async function fileToResizedDataUrl(file: File): Promise<string> {
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
