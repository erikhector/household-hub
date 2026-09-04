import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { ShoppingListClient } from "@/components/shopping/shopping-list-client";

export default async function ShoppingListPage() {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { householdId: household.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  return <ShoppingListClient list={list} />;
}
