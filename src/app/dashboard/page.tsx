import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";

export default async function DashboardOverviewPage() {
  const { household } = await requireHousehold();

  const [items, activeList] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { householdId: household.id } }),
    prisma.shoppingList.findFirst({
      where: { householdId: household.id, status: "ACTIVE" },
      include: { _count: { select: { items: { where: { purchased: false } } } } },
    }),
  ]);

  const lowStock = items.filter((item) => item.quantity <= item.lowStockThreshold);
  const outOfStock = lowStock.filter((item) => item.quantity <= 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          What needs your attention right now.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Low stock items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{lowStock.length}</p>
            {outOfStock.length > 0 && (
              <p className="text-sm text-destructive">{outOfStock.length} out of stock</p>
            )}
            <Link href="/dashboard/inventory" className="text-sm underline underline-offset-4">
              View inventory
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Shopping list
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {activeList?._count.items ?? 0}
            </p>
            <p className="text-sm text-muted-foreground">items to buy</p>
            <Link
              href="/dashboard/shopping-list"
              className="text-sm underline underline-offset-4"
            >
              View shopping list
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total items tracked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{items.length}</p>
            <p className="text-sm text-muted-foreground">in inventory</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
