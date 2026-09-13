import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { ShoppingListClient } from "@/components/shopping/shopping-list-client";

export default async function ShoppingListDetailPage(
  props: PageProps<"/dashboard/shopping-list/[id]">,
) {
  const [{ household }, dict, { id }] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    props.params,
  ]);

  const [list, inventoryItems] = await Promise.all([
    prisma.shoppingList.findFirst({
      where: { id, householdId: household.id },
      include: { items: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { id: true, name: true, category: true, unit: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!list) notFound();

  const categories = [...new Set(inventoryItems.map((item) => item.category))].sort();
  const units = [...new Set(inventoryItems.map((item) => item.unit))].sort();

  return (
    <ShoppingListClient
      list={list}
      inventoryItems={inventoryItems}
      categories={categories}
      units={units}
      dict={dict.shoppingList}
      barcodeDict={dict.barcodeScanner}
      exportLabel={dict.export.button}
    />
  );
}
