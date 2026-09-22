import Link from "next/link";
import { ChevronRight, ListChecks, PiggyBank, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GettingStarted, type GettingStartedStep } from "@/components/dashboard/getting-started";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";
import { computeSafeToSpend } from "@/lib/safe-to-spend-calc";
import { isTaskOpen } from "@/app/dashboard/tasks/recurrence";
import { getStockStatus } from "@/lib/stock-status";

function greetingKey(now: Date): "morning" | "afternoon" | "evening" {
  const hour = now.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export default async function DashboardOverviewPage() {
  const [{ household, userId }, dict, locale] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [
    user,
    myMembership,
    items,
    activeLists,
    memberCount,
    shoppingListCount,
    budgetCategoryCount,
    personalCategories,
    personalTransactions,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } }),
    prisma.householdMember.findFirst({ where: { householdId: household.id, userId } }),
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
    prisma.personalBudgetCategory.findMany({ where: { userId } }),
    prisma.personalTransaction.findMany({ where: { userId }, include: { category: true } }),
  ]);

  const myTasks = myMembership
    ? await prisma.householdTask.findMany({
        where: { householdId: household.id, assignedToMemberId: myMembership.id },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const myOpenTasks = myTasks.filter((t) => isTaskOpen(t, now));

  const personalBudgetCategoryCount = personalCategories.length;
  const personalMonthTransactions = personalTransactions.filter(
    (t) => t.date >= monthStart && t.date < monthEnd,
  );
  const personalIncome = personalMonthTransactions
    .filter((t) => t.type === "INCOME")
    .reduce((sum, t) => sum + t.amount, 0);
  const personalExpense = personalMonthTransactions
    .filter((t) => t.type === "EXPENSE")
    .reduce((sum, t) => sum + t.amount, 0);
  const personalSavings = personalMonthTransactions
    .filter((t) => t.type === "SAVINGS")
    .reduce((sum, t) => sum + t.amount, 0);
  const { safeToSpend, expectedRecurring, status: safeToSpendStatus } = computeSafeToSpend({
    transactions: personalTransactions.map((t) => ({
      categoryId: t.categoryId,
      categoryName: t.category.name,
      type: t.type,
      amount: t.amount,
      date: t.date,
      isRecurring: t.isRecurring,
    })),
    monthStart,
    monthEnd,
    incomeSoFar: personalIncome,
    expenseSoFar: personalExpense,
    savingsSoFar: personalSavings,
  });

  const pendingShoppingItems = activeLists.reduce((sum, list) => sum + list._count.items, 0);

  const lowStock = items.filter(
    (item) => getStockStatus(item.quantity, item.lowStockThreshold) !== "in",
  );
  const outOfStock = lowStock.filter(
    (item) => getStockStatus(item.quantity, item.lowStockThreshold) === "out",
  );

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
        <h1 className="font-heading text-2xl font-semibold tracking-tight break-words">
          {format(dict.dashboard.greeting[greetingKey(now)], { name: user.displayName })}
        </h1>
        <p className="text-sm text-muted-foreground">{dict.dashboard.subtitle}</p>
      </div>

      <GettingStarted steps={gettingStartedSteps} dict={dict.dashboard.gettingStarted} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-chart-5/15 text-chart-5">
                <ListChecks className="size-4 shrink-0" />
              </span>
              {dict.dashboard.yourTasksTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {myOpenTasks.length > 0 ? (
              <>
                <p className="text-sm text-foreground">
                  {format(plural(myOpenTasks.length, dict.dashboard.openTasksAssignedToYou), {
                    count: myOpenTasks.length,
                  })}
                </p>
                <ul className="flex flex-col gap-1">
                  {myOpenTasks.slice(0, 3).map((task) => (
                    <li key={task.id} className="truncate text-sm text-muted-foreground">
                      {task.title}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{dict.dashboard.noTasksAssignedToYou}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-1 w-full justify-between"
              render={<Link href="/dashboard/tasks" />}
            >
              {dict.dashboard.viewTasks}
              <ChevronRight className="size-4" />
            </Button>
          </CardContent>
        </Card>

        {personalBudgetCategoryCount > 0 ? (
          <SafeToSpend
            amount={safeToSpend}
            status={safeToSpendStatus}
            expectedRecurring={expectedRecurring}
            dict={{
              ...dict.personalBudget.safeToSpend,
              title: dict.dashboard.yourBudgetTitle,
            }}
            locale={locale}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-chart-2/15 text-chart-2">
                  <PiggyBank className="size-4 shrink-0" />
                </span>
                {dict.dashboard.yourBudgetTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{dict.personalBudget.onboarding.body}</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between"
                render={<Link href="/dashboard/personal-budget" />}
              >
                {dict.dashboard.setUpPersonalBudgetCta}
                <ChevronRight className="size-4" />
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">{dict.dashboard.householdSectionTitle}</h2>
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
              <p className="font-display text-3xl font-semibold text-chart-1">{lowStock.length}</p>
              {outOfStock.length > 0 && (
                <p className="text-sm text-destructive">
                  {format(plural(outOfStock.length, dict.dashboard.outOfStock), {
                    count: outOfStock.length,
                  })}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full justify-between"
                render={<Link href="/dashboard/inventory" />}
              >
                {dict.dashboard.viewInventory}
                <ChevronRight className="size-4" />
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {dict.dashboard.shoppingLists}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-3xl font-semibold text-chart-2">{pendingShoppingItems}</p>
              <p className="text-sm text-muted-foreground">
                {format(plural(activeLists.length, dict.dashboard.itemsToBuyAcross), {
                  count: activeLists.length,
                })}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full justify-between"
                render={<Link href="/dashboard/shopping-list" />}
              >
                {dict.dashboard.viewShoppingLists}
                <ChevronRight className="size-4" />
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {dict.dashboard.totalItemsTracked}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-3xl font-semibold text-chart-1">{items.length}</p>
              <p className="text-sm text-muted-foreground">{dict.dashboard.inInventory}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
