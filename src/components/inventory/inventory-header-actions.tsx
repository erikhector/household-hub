"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { createDialogHandle } from "@/components/ui/dialog";
import { LazyDialog, openLazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import {
  loadAiShelfScanDialog,
  loadBulkPasteDialog,
  loadBulkScanDialog,
  loadItemFormDialog,
  loadStockScanDialog,
} from "@/components/inventory/lazy-dialogs";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { format, plural } from "@/lib/i18n/format";
import { Download, Ellipsis, ListChecks, ScanBarcode, ScanLine, ClipboardList, Sparkles, Plus } from "lucide-react";
import { PrimaryAction } from "@/components/dashboard/primary-action";

type InventoryHeaderItem = { id: string; name: string; quantity: number; unit: string };

export function InventoryHeaderActionsClient({
  items,
  categories,
  locations,
  units,
  dict,
  barcodeDict,
  exportLabel,
  manageItemsLabel,
  manageItemsHref,
  duplicateGroups,
  aiShelfScanConfigured,
  aiCategoryFallbackEnabled,
}: {
  items: InventoryHeaderItem[];
  categories: string[];
  locations: string[];
  units: string[];
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  exportLabel: string;
  manageItemsLabel: string;
  manageItemsHref: string;
  duplicateGroups: number;
  // Computed server-side (page.tsx): non-NEXT_PUBLIC_ env vars are never
  // inlined into client bundles, so reading them here would always be false.
  aiShelfScanConfigured: boolean;
  aiCategoryFallbackEnabled: boolean;
}) {
  // PERF-26: the five dialogs load on first use (ui/lazy-dialog.tsx). Every
  // opener below, the desktop buttons and the phone's ⋯ menu and floating Add
  // item alike, goes through one handle per dialog, so each dialog is mounted
  // once, outside the menu (whose popup unmounts as it closes).
  const [stockHandle] = useState(() => createDialogHandle());
  const [pasteHandle] = useState(() => createDialogHandle());
  const [bulkHandle] = useState(() => createDialogHandle());
  const [aiHandle] = useState(() => createDialogHandle());
  const [addHandle] = useState(() => createDialogHandle());
  // UX-126: what the Add dialog checks a typed name against.
  const existingItems = items.map((it) => ({ id: it.id, name: it.name, quantity: it.quantity, unit: it.unit }));
  const stockItems = items.map((it: InventoryHeaderItem) => ({ id: it.id, name: it.name }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <LazyDialog loader={loadStockScanDialog} handle={stockHandle}>
        {(StockScan) => <StockScan dict={dict} barcodeDict={barcodeDict} items={stockItems} handle={stockHandle} />}
      </LazyDialog>
      <LazyDialog loader={loadBulkPasteDialog} handle={pasteHandle}>
        {(BulkPaste) => <BulkPaste dict={dict} categories={categories} locations={locations} handle={pasteHandle} />}
      </LazyDialog>
      <LazyDialog loader={loadBulkScanDialog} handle={bulkHandle}>
        {(BulkScan) => (
          <BulkScan dict={dict} barcodeDict={barcodeDict} categories={categories} locations={locations} handle={bulkHandle} />
        )}
      </LazyDialog>
      <LazyDialog loader={loadAiShelfScanDialog} handle={aiHandle}>
        {(AiShelfScan) => (
          <AiShelfScan
            dict={dict}
            categories={categories}
            locations={locations}
            configured={aiShelfScanConfigured}
            handle={aiHandle}
          />
        )}
      </LazyDialog>
      <LazyDialog loader={loadItemFormDialog} handle={addHandle}>
        {(ItemForm) => (
          <ItemForm
            mode="create"
            existingItems={existingItems}
            categories={categories}
            locations={locations}
            units={units}
            dict={dict}
            barcodeDict={barcodeDict}
            aiCategoryFallbackEnabled={aiCategoryFallbackEnabled}
            handle={addHandle}
          />
        )}
      </LazyDialog>

      {/* Desktop / tablet: keep icon buttons visible */}
      <div className="hidden sm:flex flex-wrap items-center gap-2">
        <Button variant="outline" className="gap-1.5" aria-haspopup="dialog" onClick={() => openLazyDialog(stockHandle)} {...preloadOnIntent(loadStockScanDialog)}>
          <ScanBarcode className="size-4" />
          <span className="sr-only sm:not-sr-only">{dict.stockScan.triggerLabel}</span>
        </Button>
        <Button variant="outline" className="gap-1.5" aria-haspopup="dialog" onClick={() => openLazyDialog(pasteHandle)} {...preloadOnIntent(loadBulkPasteDialog)}>
          <ClipboardList className="size-4" />
          <span className="sr-only sm:not-sr-only">{dict.pasteList.triggerLabel}</span>
        </Button>
        <Button variant="outline" className="gap-1.5" aria-haspopup="dialog" onClick={() => openLazyDialog(bulkHandle)} {...preloadOnIntent(loadBulkScanDialog)}>
          <ScanLine className="size-4" />
          <span className="sr-only sm:not-sr-only">{dict.bulkScan.triggerLabel}</span>
        </Button>
        <Button variant="outline" className="gap-1.5" aria-haspopup="dialog" onClick={() => openLazyDialog(aiHandle)} {...preloadOnIntent(loadAiShelfScanDialog)}>
          <Sparkles className="size-4" />
          <span className="sr-only sm:not-sr-only">{dict.aiShelfScan.triggerLabel}</span>
        </Button>
        {/* UX-50: with no items the empty state holds "Add item" (one primary
            on screen), so it only joins the header once there is a list. */}
        {items.length > 0 && (
          <Button className="gap-1.5" aria-haspopup="dialog" onClick={() => openLazyDialog(addHandle)} {...preloadOnIntent(loadItemFormDialog)}>
            <Plus className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.addItem}</span>
          </Button>
        )}
      </div>

      {/* Mobile: labelled Add item (floating in the thumb zone, UX-40) +
          a labelled ⋯ menu that stays in the header */}
      <div className="flex flex-wrap items-center gap-2 sm:hidden">
        {items.length > 0 && (
          <PrimaryAction>
            <Button className="gap-1.5" aria-haspopup="dialog" onClick={() => openLazyDialog(addHandle)} {...preloadOnIntent(loadItemFormDialog)}>
              <Plus className="size-4" />
              {dict.addItem}
            </Button>
          </PrimaryAction>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="h-auto max-sm:h-auto pointer-coarse:h-auto max-w-full min-h-8 max-sm:min-h-11 pointer-coarse:min-h-11 gap-1.5 py-1 whitespace-normal"><Ellipsis className="size-4" /> {dict.moreInventoryActions}</Button>} />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openLazyDialog(stockHandle)}>
              <ScanBarcode className="size-4" /> {dict.stockScan.triggerLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openLazyDialog(bulkHandle)}>
              <ScanLine className="size-4" /> {dict.bulkScan.triggerLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openLazyDialog(aiHandle)}>
              <Sparkles className="size-4" /> {dict.aiShelfScan.triggerLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openLazyDialog(pasteHandle)}>
              <ClipboardList className="size-4" /> {dict.pasteList.triggerLabel}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/dashboard/inventory/export" prefetch={false} /> }>
              <Download className="size-4" /> {exportLabel}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={manageItemsHref} prefetch={false} /> }>
              <ListChecks className="size-4" /> {manageItemsLabel}
              {duplicateGroups > 0 && (
                <Badge variant="secondary" className="ml-auto">
                  <span aria-hidden="true">{duplicateGroups}</span>
                  <span className="sr-only">{format(plural(duplicateGroups, dict.catalog.duplicateBadge), { count: duplicateGroups })}</span>
                </Badge>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default InventoryHeaderActionsClient;
