"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StockScanDialog } from "@/components/inventory/stock-scan-dialog";
import { BulkPasteDialog } from "@/components/inventory/bulk-paste-dialog";
import { BulkScanDialog } from "@/components/inventory/bulk-scan-dialog";
import { AiShelfScanDialog } from "@/components/inventory/ai-shelf-scan-dialog";
import { ItemFormDialog } from "@/components/inventory/add-item-dialog";
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
  const stockRef = useRef<HTMLButtonElement | null>(null);
  const pasteRef = useRef<HTMLButtonElement | null>(null);
  const bulkRef = useRef<HTMLButtonElement | null>(null);
  const aiRef = useRef<HTMLButtonElement | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  // UX-126: what the Add dialog checks a typed name against.
  const existingItems = items.map((it) => ({ id: it.id, name: it.name, quantity: it.quantity, unit: it.unit }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Hidden programmatic triggers (outside any menu) */}
      <StockScanDialog
        dict={dict}
        barcodeDict={barcodeDict}
        items={items.map((it: InventoryHeaderItem) => ({ id: it.id, name: it.name }))}
        trigger={<button ref={stockRef} type="button" tabIndex={-1} aria-hidden="true" className="sr-only" />}
      />
      <BulkPasteDialog dict={dict} categories={categories} locations={locations} trigger={<button ref={pasteRef} type="button" tabIndex={-1} aria-hidden="true" className="sr-only" />} />
      <BulkScanDialog dict={dict} barcodeDict={barcodeDict} categories={categories} locations={locations} trigger={<button ref={bulkRef} type="button" tabIndex={-1} aria-hidden="true" className="sr-only" />} />
      <AiShelfScanDialog dict={dict} categories={categories} locations={locations} configured={aiShelfScanConfigured} trigger={<button ref={aiRef} type="button" tabIndex={-1} aria-hidden="true" className="sr-only" />} />
      <ItemFormDialog mode="create" existingItems={existingItems} categories={categories} locations={locations} units={units} dict={dict} barcodeDict={barcodeDict} aiCategoryFallbackEnabled={aiCategoryFallbackEnabled} trigger={<button ref={addRef} type="button" tabIndex={-1} aria-hidden="true" className="sr-only" />} />

      {/* Desktop / tablet: keep icon buttons visible */}
      <div className="hidden sm:flex flex-wrap items-center gap-2">
        <StockScanDialog dict={dict} barcodeDict={barcodeDict} items={items.map((it: InventoryHeaderItem) => ({ id: it.id, name: it.name }))} trigger={
          <Button variant="outline" className="gap-1.5">
            <ScanBarcode className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.stockScan.triggerLabel}</span>
          </Button>
        } />
        <BulkPasteDialog dict={dict} categories={categories} locations={locations} trigger={
          <Button variant="outline" className="gap-1.5">
            <ClipboardList className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.pasteList.triggerLabel}</span>
          </Button>
        } />
        <BulkScanDialog dict={dict} barcodeDict={barcodeDict} categories={categories} locations={locations} trigger={
          <Button variant="outline" className="gap-1.5">
            <ScanLine className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.bulkScan.triggerLabel}</span>
          </Button>
        } />
        <AiShelfScanDialog dict={dict} categories={categories} locations={locations} configured={aiShelfScanConfigured} trigger={
          <Button variant="outline" className="gap-1.5">
            <Sparkles className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.aiShelfScan.triggerLabel}</span>
          </Button>
        } />
      <ItemFormDialog mode="create" existingItems={existingItems} categories={categories} locations={locations} units={units} dict={dict} barcodeDict={barcodeDict} aiCategoryFallbackEnabled={aiCategoryFallbackEnabled} trigger={
          <Button className="gap-1.5">
            <Plus className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.addItem}</span>
          </Button>
        } />
      </div>

      {/* Mobile: labelled Add item (floating in the thumb zone, UX-40) +
          a labelled ⋯ menu that stays in the header */}
      <div className="flex flex-wrap items-center gap-2 sm:hidden">
        <PrimaryAction>
          <Button className="gap-1.5" onClick={() => addRef.current?.click()}>
            <Plus className="size-4" />
            {dict.addItem}
          </Button>
        </PrimaryAction>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="h-auto max-sm:h-auto pointer-coarse:h-auto max-w-full min-h-8 max-sm:min-h-11 pointer-coarse:min-h-11 gap-1.5 py-1 whitespace-normal"><Ellipsis className="size-4" /> {dict.moreInventoryActions}</Button>} />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => stockRef.current?.click()}>
              <ScanBarcode className="size-4" /> {dict.stockScan.triggerLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => bulkRef.current?.click()}>
              <ScanLine className="size-4" /> {dict.bulkScan.triggerLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => aiRef.current?.click()}>
              <Sparkles className="size-4" /> {dict.aiShelfScan.triggerLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => pasteRef.current?.click()}>
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
