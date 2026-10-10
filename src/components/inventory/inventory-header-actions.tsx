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
import { Ellipsis, ScanBarcode, ScanLine, ClipboardList, Sparkles, Plus } from "lucide-react";

type InventoryHeaderItem = { id: string; name: string };

export function InventoryHeaderActionsClient({
  items,
  categories,
  locations,
  units,
  dict,
  barcodeDict,
  exportLabel,
  manageItemsLabel,
}: {
  items: InventoryHeaderItem[];
  categories: string[];
  locations: string[];
  units: string[];
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  exportLabel: string;
  manageItemsLabel: string;
}) {
  const stockRef = useRef<HTMLButtonElement | null>(null);
  const pasteRef = useRef<HTMLButtonElement | null>(null);
  const bulkRef = useRef<HTMLButtonElement | null>(null);
  const aiRef = useRef<HTMLButtonElement | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="flex items-center gap-2">
      {/* Hidden programmatic triggers (outside any menu) */}
      <StockScanDialog
        dict={dict}
        barcodeDict={barcodeDict}
        items={items.map((it: InventoryHeaderItem) => ({ id: it.id, name: it.name }))}
        trigger={<button ref={stockRef} className="sr-only" />}
      />
      <BulkPasteDialog dict={dict} categories={categories} locations={locations} trigger={<button ref={pasteRef} className="sr-only" />} />
      <BulkScanDialog dict={dict} barcodeDict={barcodeDict} categories={categories} locations={locations} trigger={<button ref={bulkRef} className="sr-only" />} />
      <AiShelfScanDialog dict={dict} categories={categories} locations={locations} configured={Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)} trigger={<button ref={aiRef} className="sr-only" />} />
      <ItemFormDialog mode="create" categories={categories} locations={locations} units={units} dict={dict} barcodeDict={barcodeDict} trigger={<button ref={addRef} className="sr-only" />} />

      {/* Desktop / tablet: keep icon buttons visible */}
      <div className="hidden sm:flex items-center gap-2">
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
        <AiShelfScanDialog dict={dict} categories={categories} locations={locations} configured={Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)} trigger={
          <Button variant="outline" className="gap-1.5">
            <Sparkles className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.aiShelfScan.triggerLabel}</span>
          </Button>
        } />
        <ItemFormDialog mode="create" categories={categories} locations={locations} units={units} dict={dict} barcodeDict={barcodeDict} aiCategoryFallbackEnabled={false} trigger={
          <Button className="gap-1.5">
            <Plus className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.addItem}</span>
          </Button>
        } />
      </div>

      {/* Mobile: labelled Add item + a labelled ⋯ menu */}
      <div className="flex items-center gap-2 sm:hidden">
        <Button className="gap-1.5" onClick={() => addRef.current?.click()}>
          <Plus className="size-4" />
          {dict.addItem}
        </Button>
        <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" className="gap-1.5"><Ellipsis className="size-4" /> {dict.moreActions ?? "More actions"}</Button>} />
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
              {exportLabel}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/dashboard/inventory/items" prefetch={false} /> }>
              {manageItemsLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default InventoryHeaderActionsClient;
