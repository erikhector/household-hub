import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { ShoppingListsOverview } from "@/components/shopping/shopping-lists-overview";

export default async function ShoppingListPage() {
  const { household } = await requireHousehold();

  const lists = await prisma.shoppingList.findMany({
    where: { householdId: household.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: { where: { purchased: false } } } } },
  });

  const toSummary = (list: (typeof lists)[number]) => ({
    id: list.id,
    name: list.name,
    status: list.status,
    pendingItemCount: list._count.items,
  });

  return (
    <ShoppingListsOverview
      active={lists.filter((l) => l.status === "ACTIVE").map(toSummary)}
      completed={lists.filter((l) => l.status === "COMPLETED").map(toSummary)}
      archived={lists.filter((l) => l.status === "ARCHIVED").map(toSummary)}
    />
  );
}
