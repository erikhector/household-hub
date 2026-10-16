import Link from "next/link";
import { ChevronRight, ListChecks, PiggyBank, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GettingStarted, type GettingStartedStep } from "@/components/dashboard/getting-started";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { isHouseholdStepSkipped } from "@/lib/household-step-skip";
import { isGettingStartedDismissed } from "@/lib/getting-started-dismiss";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";
import { loadPersonalBudgetPosition } from "@/lib/personal-budget-position";
import { isTaskOpen } from "@/app/dashboard/tasks/recurrence";
import { getStockStatus } from "@/lib/stock-status";
import { Greeting } from "@/components/dashboard/greeting";
import { firstName } from "@/lib/greeting";
import { PageTitle } from "@/components/dashboard/page-title";
import { getActiveBatches } from "@/app/dashboard/meal-planning/prepared-batches";

// The "View …" link at the foot of each overview card (UX-26). `mt-auto`
// pins it to the card's bottom, so side-by-side cards with different amounts
// of content above (an "out of stock" line in one, not the other) line their
// buttons up instead of leaving them at different heights. The label may
// wrap (`whitespace-normal`, `h-auto` over the fixed button height) because
// on a tablet the three-up row leaves each card ~150px, too narrow for
// "View shopping lists" on one line: unwrapped, it pushed the chevron out
// onto the card's border.
const CARD_LINK_BUTTON = "mt-auto h-auto min-h-7 w-full justify-between py-1 text-left whitespace-normal max-sm:h-auto pointer-coarse:h-auto max-sm:min-h-11 pointer-coarse:min-h-11";

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
    myTasks,
    items,
    activeLists,
    memberCount,
    shoppingListCount,
    budgetCategoryCount,
    personalBudgetCategoryCount,
    personalPosition,
    householdStepSkipped,
    gettingStartedDismissed,
    prepBatches,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } }),
    // Filtered by the assignee's user rather than a membership id looked up
    // first, so it runs in parallel with everything else instead of after it.
    prisma.householdTask.findMany({
      where: { householdId: household.id, assignedToMember: { userId } },
      orderBy: { createdAt: "asc" },
    }),
    // Only the two columns the low-stock filter reads (the card also counts
    // the rows) — not every inventory column for every item.
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { quantity: true, lowStockThreshold: true },
    }),
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
    // The exact same number Personal Budget shows for this month — shared
    // bills, what's owed to household members, due payments and savings
    // included. See src/lib/personal-budget-position.ts; this card used to
    // run its own simplified copy of the math that left all of that out.
    loadPersonalBudgetPosition({
      userId,
      monthStart,
      monthEnd,
      sharedLabel: dict.personalBudget.shared.sharedBadge,
    }),
    isHouseholdStepSkipped(household.id),
    isGettingStartedDismissed(household.id),
    getActiveBatches(household.id),
  ]);

  const myOpenTasks = myTasks.filter((t) => isTaskOpen(t, now));

  const pendingShoppingItems = activeLists.reduce((sum, list) => sum + list._count.items, 0);

  const lowStock = items.filter(
    (item) => getStockStatus(item.quantity, item.lowStockThreshold) !== "in",
  );
  const outOfStock = lowStock.filter(
    (item) => getStockStatus(item.quantity, item.lowStockThreshold) === "out",
  );

  // GAP-49: batches still holding portions, soonest eat-by first
  // (getActiveBatches' order). An emptied batch whose last portions are only
  // planned stays on the Prep tab, but here it's nothing left to eat.
  const prepWithPortions = prepBatches.filter((batch) => batch.remainingPortions > 0);
  // Formatted in UTC like the Prep tab, so server and browser name one day.
  const prepDayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  const gettingStartedSteps: GettingStartedStep[] = [
    {
      key: "household",
      href: "/dashboard/household",
      done: memberCount > 0,
      skipped: memberCount === 0 && householdStepSkipped,
    },
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
        <PageTitle>
          <Greeting name={firstName(user.displayName)} dict={dict.dashboard.greeting} />
        </PageTitle>
        <p className="text-sm text-muted-foreground">{dict.dashboard.subtitle}</p>
      </div>

      {!gettingStartedDismissed && (
        <GettingStarted steps={gettingStartedSteps} dict={dict.dashboard.gettingStarted} />
      )}

      <div className="list-bleed grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-success/15 text-success">
                <ListChecks className="size-4 shrink-0" />
              </span>
              {dict.dashboard.yourTasksTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            {myOpenTasks.length > 0 ? (
              <>
                <p className="text-sm text-foreground">
                  {format(plural(myOpenTasks.length, dict.dashboard.openTasksAssignedToYou), {
                    count: myOpenTasks.length,
                  })}
                </p>
                <ul className="flex flex-col gap-1">
                  {myOpenTasks.slice(0, 3).map((task) => (
                    <li key={task.id} className="line-clamp-2 break-words sm:line-clamp-1 text-sm text-muted-foreground">
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
              className={CARD_LINK_BUTTON}
              render={<Link href="/dashboard/tasks" />}
            >
              {dict.dashboard.viewTasks}
              <ChevronRight className="size-4" />
            </Button>
          </CardContent>
        </Card>

        {personalBudgetCategoryCount > 0 ? (
          <SafeToSpend
            amount={personalPosition.safeToSpend}
            status={personalPosition.safeToSpendStatus}
            breakdown={personalPosition.safeToSpendBreakdown}
            expectedRecurring={personalPosition.expectedRecurring}
            householdDebts={personalPosition.householdDebts}
            showHouseholdName={personalPosition.showHouseholdName}
            projection={personalPosition.safeToSpendProjection}
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
            <CardContent className="flex flex-1 flex-col gap-3">
              <p className="text-sm text-muted-foreground">{dict.personalBudget.onboarding.body}</p>
              <Button
                variant="outline"
                size="sm"
                className={CARD_LINK_BUTTON}
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
          <div className="list-bleed flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            <Users className="size-4 shrink-0" />
            <span
              className="min-w-0 flex-1 line-clamp-2 break-words sm:line-clamp-1"
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
            <Link href="/dashboard/household" className="touch-target ml-auto shrink-0 justify-end underline underline-offset-4">
              {dict.dashboard.manage}
            </Link>
          </div>
        )}
        <div className="list-bleed grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {dict.dashboard.lowStockItems}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-1">
              <p className="font-display text-3xl font-semibold text-warning">{lowStock.length}</p>
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
                className={CARD_LINK_BUTTON}
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
            <CardContent className="flex flex-1 flex-col gap-1">
              <p className="font-display text-3xl font-semibold text-primary">{pendingShoppingItems}</p>
              <p className="text-sm text-muted-foreground">
                {format(plural(activeLists.length, dict.dashboard.itemsToBuyAcross), {
                  count: activeLists.length,
                })}
              </p>
              <Button
                variant="outline"
                size="sm"
                className={CARD_LINK_BUTTON}
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
              <p className="font-display text-3xl font-semibold text-foreground">{items.length}</p>
              <p className="text-sm text-muted-foreground">{dict.dashboard.inInventory}</p>
            </CardContent>
          </Card>
        </div>
        {prepWithPortions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {dict.dashboard.mealPrepTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <ul className="flex flex-col gap-2">
                {prepWithPortions.slice(0, 3).map((batch) => (
                  <li key={batch.id} className="flex flex-col">
                    <span className="line-clamp-2 break-words text-sm font-medium text-foreground">
                      {batch.recipeName}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {format(plural(batch.totalPortions, dict.mealPlanning.prepPortionsLeft), {
                        remaining: batch.remainingPortions,
                        total: batch.totalPortions,
                      })}
                      {batch.expiryDate &&
                        ` · ${format(dict.mealPlanning.prepEatBy, {
                          day: prepDayFormat.format(new Date(batch.expiryDate)),
                        })}`}
                    </span>
                  </li>
                ))}
              </ul>
              <Button
                variant="outline"
                size="sm"
                className={CARD_LINK_BUTTON}
                render={<Link href="/dashboard/meal-planning?tab=prep" />}
              >
                {dict.dashboard.viewMealPrep}
                <ChevronRight className="size-4" />
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
