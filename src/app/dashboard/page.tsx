import Link from "next/link";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GettingStarted, type GettingStartedStep } from "@/components/dashboard/getting-started";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";

export default async function DashboardOverviewPage() {
  const [{ household, userId }, dict] = await Promise.all([requireHousehold(), getDictionary()]);

  const [
    items,
    activeLists,
    memberCount,
    shoppingListCount,
    budgetCategoryCount,
    personalBudgetCategoryCount,
  ] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { householdId: household.id } }),
    prisma.shoppingList.findMany({
      where: { householdId: household.id, status: "ACTIVE" },
      include: { _count: { select: { items: { where: { purchased: false } } } } },
    }),
    prisma.householdMember.count({
      where: { householdId: household.id, userId: { not: userId } },
    }),
    prisma.shoppingList.count({ where: { householdId: household.id } }),
    prisma.budgetCategory.count({ where: { householdId: household.id } }),
    prisma.personalBudgetCategory.count({ where: { userId } }),
  ]);

  const pendingShoppingItems = activeLists.reduce((sum, list) => sum + list._count.items, 0);

  const lowStock = items.filter((item) => item.quantity <= item.lowStockThreshold);
  const outOfStock = lowStock.filter((item) => item.quantity <= 0);

  const gettingStartedSteps: GettingStartedStep[] = [
    { key: "household", href: "/dashboard/household", done: memberCount > 0 },
    { key: "inventory", href: "/dashboard/inventory", done: items.length > 0 },
    { key: "shoppingList", href: "/dashboard/shopping-list", done: shoppingListCount > 0 },
    { key: "budget", href: "/dashboard/budget", done: budgetCategoryCount > 0 },
    {
      key: "personalBudget",
      href: "/dashboard/personal-budget",
      done: personalBudgetCategoryCount > 0,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{dict.dashboard.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.dashboard.subtitle}</p>
      </div>
      <GettingStarted steps={gettingStartedSteps} dict={dict.dashboard.gettingStarted} />
      {memberCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <Users className="size-4 shrink-0" />
          <span
            className="min-w-0 flex-1 truncate"
            title={format(plural(memberCount, dict.dashboard.sharedWithIn), {
              count: memberCount,
              name: household.name,
            })}
          >
            {format(plural(memberCount, dict.dashboard.sharedWithIn), {
              count: memberCount,
              name: household.name,
            })}
          </span>
          <Link href="/dashboard/household" className="ml-auto shrink-0 underline underline-offset-4">
            {dict.dashboard.manage}
          </Link>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.dashboard.lowStockItems}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{lowStock.length}</p>
            {outOfStock.length > 0 && (
              <p className="text-sm text-destructive">
                {format(plural(outOfStock.length, dict.dashboard.outOfStock), {
                  count: outOfStock.length,
                })}
              </p>
            )}
            <Link href="/dashboard/inventory" className="text-sm underline underline-offset-4">
              {dict.dashboard.viewInventory}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.dashboard.shoppingLists}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{pendingShoppingItems}</p>
            <p className="text-sm text-muted-foreground">
              {format(plural(activeLists.length, dict.dashboard.itemsToBuyAcross), {
                count: activeLists.length,
              })}
            </p>
            <Link
              href="/dashboard/shopping-list"
              className="text-sm underline underline-offset-4"
            >
              {dict.dashboard.viewShoppingLists}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.dashboard.totalItemsTracked}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{items.length}</p>
            <p className="text-sm text-muted-foreground">{dict.dashboard.inInventory}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
