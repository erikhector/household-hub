import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { AddItemDialog } from "@/components/inventory/add-item-dialog";
import { InventoryClient } from "@/components/inventory/inventory-client";
import { ExportCsvButton } from "@/components/export/export-csv-button";

export default async function InventoryPage() {
  const [{ household }, dict] = await Promise.all([requireHousehold(), getDictionary()]);

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
        <div className="flex items-center gap-2">
          <ExportCsvButton href="/dashboard/inventory/export" label={dict.export.button} />
          <AddItemDialog categories={categories} locations={locations} dict={dict.inventory} />
        </div>
      </div>
      <InventoryClient items={items} categories={categories} locations={locations} dict={dict.inventory} />
    </div>
  );
}
