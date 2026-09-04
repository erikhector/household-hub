import Link from "next/link";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";

export default async function DashboardOverviewPage() {
  const { household, userId } = await requireHousehold();

  const [items, activeLists, memberCount] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { householdId: household.id } }),
    prisma.shoppingList.findMany({
      where: { householdId: household.id, status: "ACTIVE" },
      include: { _count: { select: { items: { where: { purchased: false } } } } },
    }),
    prisma.householdMember.count({
      where: { householdId: household.id, userId: { not: userId } },
    }),
  ]);

  const pendingShoppingItems = activeLists.reduce((sum, list) => sum + list._count.items, 0);

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
      {memberCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <Users className="size-4 shrink-0" />
          <span>
            Shared with {memberCount} other {memberCount === 1 ? "person" : "people"} in{" "}
            {household.name}
          </span>
          <Link href="/dashboard/household" className="ml-auto shrink-0 underline underline-offset-4">
            Manage
          </Link>
        </div>
      )}
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
              Shopping lists
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{pendingShoppingItems}</p>
            <p className="text-sm text-muted-foreground">
              items to buy across {activeLists.length} active{" "}
              {activeLists.length === 1 ? "list" : "lists"}
            </p>
            <Link
              href="/dashboard/shopping-list"
              className="text-sm underline underline-offset-4"
            >
              View shopping lists
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
