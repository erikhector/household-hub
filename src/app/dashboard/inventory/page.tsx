import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { AddItemDialog } from "@/components/inventory/add-item-dialog";
import { InventoryClient } from "@/components/inventory/inventory-client";

export default async function InventoryPage() {
  const { household } = await requireHousehold();

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
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            What&apos;s in the house right now.
          </p>
        </div>
        <AddItemDialog categories={categories} locations={locations} />
      </div>
      <InventoryClient items={items} categories={categories} locations={locations} />
    </div>
  );
}
