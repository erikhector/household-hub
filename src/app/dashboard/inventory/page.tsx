import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { ItemFormDialog } from "@/components/inventory/add-item-dialog";
import { InventoryClient } from "@/components/inventory/inventory-client";
import { ExportButton } from "@/components/export/export-button";
import type { StockStatus } from "@/lib/stock-status";

// Status values the notification bell's low-stock alerts link to (e.g.
// `/dashboard/inventory?status=low`) — see src/lib/notifications.ts and
// src/components/notifications/notification-bell.tsx.
const LINKABLE_STATUSES: StockStatus[] = ["low", "out"];

export default async function InventoryPage(props: PageProps<"/dashboard/inventory">) {
  const [{ household }, dict, locale, searchParams] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    props.searchParams,
  ]);

  const statusParam = searchParams.status;
  const statusParamValue = Array.isArray(statusParam) ? statusParam[0] : statusParam;
  const initialStatus = LINKABLE_STATUSES.find((status) => status === statusParamValue);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dict.inventory.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.inventory.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton href="/dashboard/inventory/export" label={dict.export.button} />
          <ItemFormDialog
            mode="create"
            categories={categories}
            locations={locations}
            units={units}
            dict={dict.inventory}
            barcodeDict={dict.barcodeScanner}
            trigger={<Button>{dict.inventory.addItem}</Button>}
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
      />
    </div>
  );
}
