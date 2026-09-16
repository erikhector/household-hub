import { ClipboardList, Plus, ScanLine, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ItemFormDialog } from "@/components/inventory/add-item-dialog";
import { BulkScanDialog } from "@/components/inventory/bulk-scan-dialog";
import { BulkPasteDialog } from "@/components/inventory/bulk-paste-dialog";
import { AiShelfScanDialog } from "@/components/inventory/ai-shelf-scan-dialog";
import { InventoryClient } from "@/components/inventory/inventory-client";
import { parseInventoryViewPrefs } from "@/components/inventory/inventory-table-utils";
import { ExportButton } from "@/components/export/export-button";
import { getStockStatus, type StockStatus } from "@/lib/stock-status";
import { getUserPreferences } from "@/lib/preferences";

// Status values the notification bell's low-stock alerts link to (e.g.
// `/dashboard/inventory?status=low`) — see src/lib/notifications.ts and
// src/components/notifications/notification-bell.tsx.
const LINKABLE_STATUSES: StockStatus[] = ["low", "out"];

export default async function InventoryPage(props: PageProps<"/dashboard/inventory">) {
  const [{ household }, dict, locale, searchParams, prefs] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    props.searchParams,
    getUserPreferences(),
  ]);

  const statusParam = searchParams.status;
  const statusParamValue = Array.isArray(statusParam) ? statusParam[0] : statusParam;
  // A notification-bell link's ?status= (see LINKABLE_STATUSES above) is an
  // explicit ask to view a specific status right now, so it overrides
  // whatever status filter was last saved.
  const initialStatus = LINKABLE_STATUSES.find((status) => status === statusParamValue);
  const initialViewPrefs = parseInventoryViewPrefs(prefs?.inventoryViewPrefs);

  const [items, householdMembers] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      orderBy: { name: "asc" },
    }),
    // Resolved to display names for the "last updated by" note — see
    // InventoryItem.updatedByUserId's doc comment in schema.prisma.
    prisma.householdMember.findMany({
      where: { householdId: household.id },
      include: { user: { select: { displayName: true } } },
    }),
  ]);

  const members = householdMembers.map((m) => ({ userId: m.userId, displayName: m.user.displayName }));

  const categories = [...new Set(items.map((item) => item.category))].sort();
  const locations = [...new Set(items.flatMap((item) => (item.location ? [item.location] : [])))].sort();
  const units = [...new Set(items.map((item) => item.unit))].sort();

  // Footnote-weight positive state (see JOY_GAP_BACKLOG.md item 2): the
  // common case right after a restock — nothing low or out — otherwise gets
  // no acknowledgment at all. Deliberately quiet (small, muted text, no
  // badge/icon) so it doesn't compete with the item table below it.
  const isWellStocked =
    items.length > 0 && items.every((item) => getStockStatus(item.quantity, item.lowStockThreshold) === "in");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.inventory.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.inventory.subtitle}</p>
          {isWellStocked && <p className="text-xs text-muted-foreground">{dict.inventory.wellStocked}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton href="/dashboard/inventory/export" label={dict.export.button} />
          <BulkPasteDialog
            dict={dict.inventory}
            categories={categories}
            locations={locations}
            trigger={
              <Button variant="outline" className="gap-1.5">
                <ClipboardList className="size-4" />
                <span className="sr-only sm:not-sr-only">{dict.inventory.pasteList.triggerLabel}</span>
              </Button>
            }
          />
          <BulkScanDialog
            dict={dict.inventory}
            barcodeDict={dict.barcodeScanner}
            categories={categories}
            locations={locations}
            trigger={
              <Button variant="outline" className="gap-1.5">
                <ScanLine className="size-4" />
                <span className="sr-only sm:not-sr-only">{dict.inventory.bulkScan.triggerLabel}</span>
              </Button>
            }
          />
          <AiShelfScanDialog
            dict={dict.inventory}
            categories={categories}
            locations={locations}
            configured={Boolean(process.env.ANTHROPIC_API_KEY)}
            trigger={
              <Button variant="outline" className="gap-1.5">
                <Sparkles className="size-4" />
                <span className="sr-only sm:not-sr-only">{dict.inventory.aiShelfScan.triggerLabel}</span>
                <Badge variant="secondary" className="hidden sm:inline-flex">
                  {dict.inventory.aiShelfScan.betaBadge}
                </Badge>
              </Button>
            }
          />
          <ItemFormDialog
            mode="create"
            categories={categories}
            locations={locations}
            units={units}
            dict={dict.inventory}
            barcodeDict={dict.barcodeScanner}
            trigger={
              <Button className="gap-1.5">
                <Plus className="size-4" />
                <span className="sr-only sm:not-sr-only">{dict.inventory.addItem}</span>
              </Button>
            }
          />
        </div>
      </div>
      <InventoryClient
        items={items}
        categories={categories}
        locations={locations}
        units={units}
        members={members}
        locale={locale}
        dict={dict.inventory}
        barcodeDict={dict.barcodeScanner}
        initialStatus={initialStatus}
        initialViewPrefs={initialViewPrefs}
      />
    </div>
  );
}
