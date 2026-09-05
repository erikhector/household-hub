import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { AddItemDialog } from "@/components/inventory/add-item-dialog";
import { InventoryClient } from "@/components/inventory/inventory-client";
import type { StockStatus } from "@/lib/stock-status";

// Status values the notification bell's low-stock alerts link to (e.g.
// `/dashboard/inventory?status=low`) — see src/lib/notifications.ts and
// src/components/notifications/notification-bell.tsx.
const LINKABLE_STATUSES: StockStatus[] = ["low", "out"];

export default async function InventoryPage(props: PageProps<"/dashboard/inventory">) {
  const [{ household }, dict, searchParams] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    props.searchParams,
  ]);

  const statusParam = searchParams.status;
  const statusParamValue = Array.isArray(statusParam) ? statusParam[0] : statusParam;
  const initialStatus = LINKABLE_STATUSES.find((status) => status === statusParamValue);

  const items = await prisma.inventoryItem.findMany({
    where: { householdId: household.id },
    orderBy: { name: "asc" },
  });

  const categories = [...new Set(items.map((item) => item.category))].sort();
  const locations = [...new Set(items.flatMap((item) => (item.location ? [item.location] : [])))].sort();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dict.inventory.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.inventory.subtitle}</p>
        </div>
        <AddItemDialog categories={categories} locations={locations} dict={dict.inventory} />
      </div>
      <InventoryClient
        items={items}
        categories={categories}
        locations={locations}
        dict={dict.inventory}
        initialStatus={initialStatus}
      />
    </div>
  );
}
