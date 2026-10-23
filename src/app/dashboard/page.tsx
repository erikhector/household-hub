import Link from "next/link";
import { ChevronRight, CircleCheck, PiggyBank, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GettingStarted, type GettingStartedStep } from "@/components/dashboard/getting-started";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { TodayBlock, type TodayTask } from "@/components/dashboard/today-block";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { isHouseholdStepSkipped } from "@/lib/household-step-skip";
import { isGettingStartedCelebrated, isGettingStartedDismissed } from "@/lib/getting-started-dismiss";
import { getTimeZone } from "@/lib/get-time-zone";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";
import { loadPersonalBudgetPosition } from "@/lib/personal-budget-position";
import { isTaskOpen } from "@/app/dashboard/tasks/recurrence";
import { daysOverdue, getTaskDueDay, sortByUrgency, todayDayNumber } from "@/app/dashboard/tasks/task-due";
import { getStockStatus } from "@/lib/stock-status";
import { getExpiryStatus } from "@/lib/inventory/expiry";
import { loadHouseholdSafeToSpend } from "@/lib/household-safe-to-spend";
import { createMoneyFormat } from "@/lib/currency";
import { parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { Greeting } from "@/components/dashboard/greeting";
import { WelcomeToast } from "@/components/dashboard/welcome-toast";
import { firstName } from "@/lib/greeting";
import { PageTitle } from "@/components/dashboard/page-title";
import { getActiveBatches } from "@/app/dashboard/meal-planning/prepared-batches";

// UX-70: how many tasks the Today block lists before "N more".
const TODAY_TASK_LIMIT = 5;

// The "View …" link at the foot of each overview card (UX-26). `mt-auto`
// pins it to the card's bottom, so side-by-side cards with different amounts
// of content above (an "out of stock" line in one, not the other) line their
// buttons up instead of leaving them at different heights. The label may
// wrap (`whitespace-normal`, `h-auto` over the fixed button height) because
// on a tablet the three-up row leaves each card ~150px, too narrow for
// "View shopping lists" on one line: unwrapped, it pushed the chevron out
// onto the card's border.
const CARD_LINK_BUTTON = "mt-auto h-auto min-h-7 w-full justify-between py-1 text-left whitespace-normal max-sm:h-auto pointer-coarse:h-auto max-sm:min-h-11 pointer-coarse:min-h-11";

export default async function DashboardOverviewPage(props: PageProps<"/dashboard">) {
  const [{ household, userId }, dict, locale, searchParams] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    props.searchParams,
  ]);
  // UX-135: set by the verification link's sign-in (verifyEmailAction).
  const showWelcome = searchParams.welcome === "1";

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [
    user,
    todayTasks,
    items,
    activeLists,
    memberCount,
    shoppingListCount,
    householdBudget,
    personalBudgetCategoryCount,
    personalPosition,
    tonightEntries,
    householdStepSkipped,
    gettingStartedDismissed,
    gettingStartedCelebrated,
    plannedMealCount,
    prepBatches,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } }),
    // UX-70: the tasks that need *you*: yours and the unassigned ones
    // (nobody's, so anybody's). Filtered by the assignee's user rather than a
    // membership id looked up first, so it runs in parallel with everything
    // else instead of after it. A completed task can only reopen if it
    // recurs, so the rest of the done ones are left in the database.
    prisma.householdTask.findMany({
      where: {
        householdId: household.id,
        OR: [{ assignedToMemberId: null }, { assignedToMember: { userId } }],
        AND: [{ OR: [{ completedAt: null }, { recurrenceIntervalDays: { not: null } }] }],
      },
      select: {
        id: true,
        title: true,
        assignedToMemberId: true,
        completedAt: true,
        recurrenceIntervalDays: true,
        recurrenceAnchorAt: true,
        dueDate: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    // Only the columns the low-stock and expiring filters read (the card also
    // counts the rows) — not every inventory column for every item.
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { id: true, quantity: true, lowStockThreshold: true, expiresAt: true },
    }),
    prisma.shoppingList.findMany({
      where: { householdId: household.id, status: "ACTIVE" },
      // The rows still to buy: their count for the card, and which inventory
      // items they restock for its "already on your list" line.
      select: {
        id: true,
        name: true,
        items: { where: { purchased: false }, select: { inventoryItemId: true } },
      },
    }),
    prisma.householdMember.count({
      where: { householdId: household.id, userId: { not: userId } },
    }),
    prisma.shoppingList.count({ where: { householdId: household.id } }),
    // The household's safe to spend only exists once the budget has
    // categories, so the count gates it, inside this one parallel slot.
    prisma.budgetCategory.count({ where: { householdId: household.id } }).then(async (count) => ({
      count,
      safeToSpend: count > 0 ? await loadHouseholdSafeToSpend(household.id, now, household.budgetMonthStartDay) : null,
    })),
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
    // Tonight's dinner. Planner dates are UTC midnights (date-utils.ts), so
    // today is the UTC date key, like the planner's own "today".
    prisma.mealPlanEntry.findMany({
      where: {
        mealPlan: { householdId: household.id },
        date: parseDateKey(toDateKey(now)),
        mealType: "DINNER",
      },
      select: { freeformName: true, recipe: { select: { name: true } } },
    }),
    isHouseholdStepSkipped(household.id),
    isGettingStartedDismissed(household.id),
    isGettingStartedCelebrated(household.id),
    // UX-69: the "Plan this week's meals" step is done once anything is planned.
    prisma.mealPlanEntry.count({ where: { mealPlan: { householdId: household.id } } }),
    getActiveBatches(household.id),
  ]);
  const budgetCategoryCount = householdBudget.count;

  // Open tasks first, yours before the household's unassigned ones (stable,
  // so each group keeps its oldest-first order), then by urgency (UX-133):
  // overdue, due today, due later, undated. The sort is stable too, so the
  // order above breaks ties, and the overdue ones are never cut off by the
  // "N more" limit.
  const timeZone = await getTimeZone();
  const today = todayDayNumber(now, timeZone);
  const openTasks = sortByUrgency(
    todayTasks
      .filter((t) => isTaskOpen(t, now, timeZone))
      .map((t) => ({
        id: t.id,
        title: t.title,
        unassigned: t.assignedToMemberId === null,
        dueDay: getTaskDueDay(t, timeZone),
      }))
      .sort((a, b) => Number(a.unassigned) - Number(b.unassigned)),
    today,
  ).map(({ dueDay, ...task }) => ({ ...task, overdueDays: daysOverdue(dueDay, today) }));
  const shownTasks: TodayTask[] = openTasks.slice(0, TODAY_TASK_LIMIT);
  const tonight = tonightEntries
    .map((entry) => entry.recipe?.name ?? entry.freeformName)
    .filter((name): name is string => !!name);
  const expiringCount = items.filter(
    (item) => item.quantity > 0 && getExpiryStatus(item.expiresAt, now.getTime()) !== null,
  ).length;
  const safeToSpend = householdBudget.safeToSpend
    ? {
        formatted: createMoneyFormat(locale, household.currencyCode).format(householdBudget.safeToSpend.amount),
        status: householdBudget.safeToSpend.status,
      }
    : null;

  const pendingShoppingItems = activeLists.reduce((sum, list) => sum + list.items.length, 0);
  const onListItemIds = new Set(activeLists.flatMap((list) => list.items.map((row) => row.inventoryItemId)));

  // UX-71: "low" is the inventory filter's own meaning (low but not out), so
  // the number and the link it sits on agree. Out-of-stock is its own line.
  const needsRestock = items.filter((item) => getStockStatus(item.quantity, item.lowStockThreshold) !== "in");
  const lowCount = needsRestock.filter(
    (item) => getStockStatus(item.quantity, item.lowStockThreshold) === "low",
  ).length;
  const outCount = needsRestock.length - lowCount;
  const alreadyOnListCount = needsRestock.filter((item) => onListItemIds.has(item.id)).length;
  const lowStockHref = lowCount > 0 ? "/dashboard/inventory?status=low" : "/dashboard/inventory?status=out";
  // One active list: the card opens it rather than the index.
  const onlyList = activeLists.length === 1 ? activeLists[0] : null;

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
    { key: "mealPlan", href: "/dashboard/meal-planning", done: plannedMealCount > 0 },
    { key: "budget", href: "/dashboard/budget", done: budgetCategoryCount > 0 },
    // No personal-budget step (UX-69): the "Your budget" card below already
    // is that feature's call to action, and two stacked prompts for one
    // optional feature were one too many on the first screen.
  ];

  return (
    <div className="flex flex-col gap-6">
      {showWelcome && (
        <WelcomeToast message={format(dict.dashboard.welcome, { name: firstName(user.displayName) })} />
      )}
      <div>
        <PageTitle>
          <Greeting name={firstName(user.displayName)} dict={dict.dashboard.greeting} />
        </PageTitle>
        <p className="text-sm text-muted-foreground">{dict.dashboard.subtitle}</p>
      </div>

      <TodayBlock
        tasks={shownTasks}
        moreTaskCount={openTasks.length - shownTasks.length}
        tonight={tonight}
        safeToSpend={safeToSpend}
        expiringCount={expiringCount}
        dict={dict.dashboard.today}
        taskDict={{
          toggleCompleteAriaLabel: dict.tasks.toggleCompleteAriaLabel,
          toggleIncompleteAriaLabel: dict.tasks.toggleIncompleteAriaLabel,
          doneToast: dict.tasks.doneToast,
          undo: dict.tasks.swipe.undo,
          saveFailedToast: dict.tasks.saveFailedToast,
          overdueLabel: dict.tasks.overdueLabel,
        }}
      />

      {!gettingStartedDismissed && (
        <GettingStarted
          steps={gettingStartedSteps}
          celebrated={gettingStartedCelebrated}
          dict={dict.dashboard.gettingStarted}
        />
      )}

      <div>
        {personalBudgetCategoryCount > 0 ? (
          <SafeToSpend
            amount={personalPosition.safeToSpend}
            status={personalPosition.safeToSpendStatus}
            breakdown={personalPosition.safeToSpendBreakdown}
            expectedRecurring={personalPosition.expectedRecurring}
            householdDebts={personalPosition.householdDebts}
            showHouseholdName={personalPosition.showHouseholdName}
            projection={personalPosition.safeToSpendProjection}
            dailyAllowance={personalPosition.safeToSpendDaily}
            setupHrefs={{
              income: "/dashboard/personal-budget?tab=transactions",
              bills: "/dashboard/personal-budget?tab=manage",
            }}
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
              {needsRestock.length === 0 ? (
                <p className="flex items-center gap-2 font-display text-xl font-semibold text-success">
                  <CircleCheck className="size-6 shrink-0" aria-hidden="true" />
                  {dict.dashboard.allStockedUp}
                </p>
              ) : (
                <>
                  {/* Warning colour only for a real count; a 0 beside an
                      out-of-stock line is just a number. */}
                  <p
                    className={`font-display text-3xl font-semibold ${lowCount > 0 ? "text-warning" : "text-foreground"}`}
                  >
                    {lowCount}
                  </p>
                  {outCount > 0 && (
                    <p className="text-sm text-destructive">
                      {format(plural(outCount, dict.dashboard.outOfStock), { count: outCount })}
                    </p>
                  )}
                  {alreadyOnListCount > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {format(plural(alreadyOnListCount, dict.dashboard.alreadyOnList), {
                        count: alreadyOnListCount,
                      })}
                    </p>
                  )}
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className={CARD_LINK_BUTTON}
                render={<Link href={needsRestock.length === 0 ? "/dashboard/inventory" : lowStockHref} />}
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
              {activeLists.length === 0 ? (
                <p className="text-sm text-muted-foreground">{dict.dashboard.noListsYet}</p>
              ) : (
                <>
                  <p className="font-display text-3xl font-semibold text-primary">{pendingShoppingItems}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(plural(activeLists.length, dict.dashboard.itemsToBuyAcross), {
                      count: activeLists.length,
                    })}
                  </p>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className={CARD_LINK_BUTTON}
                render={
                  <Link href={onlyList ? `/dashboard/shopping-list/${onlyList.id}` : "/dashboard/shopping-list"} />
                }
              >
                {activeLists.length === 0
                  ? dict.dashboard.startShoppingList
                  : onlyList
                    ? format(dict.dashboard.openShoppingList, { name: onlyList.name })
                    : dict.dashboard.viewShoppingLists}
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
            <CardContent className="flex flex-1 flex-col gap-1">
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{dict.dashboard.nothingTrackedYet}</p>
              ) : (
                <>
                  <p className="font-display text-3xl font-semibold text-foreground">{items.length}</p>
                  <p className="text-sm text-muted-foreground">{dict.dashboard.inInventory}</p>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className={CARD_LINK_BUTTON}
                render={<Link href="/dashboard/inventory" />}
              >
                {items.length === 0 ? dict.dashboard.addFirstItem : dict.dashboard.browseItems}
                <ChevronRight className="size-4" />
              </Button>
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
