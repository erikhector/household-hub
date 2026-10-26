"use client";

import { useState, type ComponentProps } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import { loadReceiptScanDialog } from "@/components/shopping/lazy-dialogs";
import type { ReceiptScanDialog } from "@/components/shopping/receipt-scan-dialog";

/**
 * PERF-25: the receipt scan button on the list page, with the scan flow (OCR
 * glue, review rows, item combobox) loaded on demand.
 *
 * ReceiptScanDialog owns its opener, a menu button, so it can't be hidden
 * behind a handle like the other dialogs. Until its chunk is mounted this
 * renders a stand-in that looks the same; a tap asks for the real one, which
 * mounts with its menu already open, so the first tap still lands on the
 * "Take photo / Choose photo" choices. The chunk is normally fetched in idle
 * time long before that, making the swap invisible.
 */
export function LazyReceiptScan(props: ComponentProps<typeof ReceiptScanDialog>) {
  const [requested, setRequested] = useState(false);
  const noPendingRows = props.pendingItems.length === 0;
  return (
    <LazyDialog
      loader={loadReceiptScanDialog}
      open={requested}
      fallback={
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="outline"
            disabled={noPendingRows}
            aria-haspopup="menu"
            onClick={() => setRequested(true)}
            {...preloadOnIntent(loadReceiptScanDialog)}
          >
            <Camera className="size-4" />
            {props.dict.scanButton}
          </Button>
          {noPendingRows && <p className="text-xs text-muted-foreground">{props.dict.scanDisabledHint}</p>}
        </div>
      }
    >
      {(ReceiptScan) => <ReceiptScan {...props} defaultMenuOpen />}
    </LazyDialog>
  );
}
