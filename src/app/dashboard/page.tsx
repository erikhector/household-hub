import { SampleDataCard } from "@/components/dashboard/sample-data-card";
import { loadSampleDataState } from "@/lib/sample-data-state";
import { GettingStarted, type GettingStartedStep } from "@/components/dashboard/getting-started";
import { TodayBlock, type TodayMissing, type TodayTask } from "@/components/dashboard/today-block";
import { ShoppingPantryCard } from "@/components/dashboard/shopping-pantry-card";
import { SafeToSpendTiles } from "@/components/dashboard/safe-to-spend-tiles";
import { HomeAddToList } from "@/components/dashboard/home-add-to-list";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { isHouseholdStepSkipped } from "@/lib/household-step-skip";
import { isGettingStartedCelebrated, isGettingStartedDismissed } from "@/lib/getting-started-dismiss";
import { getTimeZone } from "@/lib/get-time-zone";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { datedName, format, plural } from "@/lib/i18n/format";
import { loadPersonalBudgetPosition } from "@/lib/personal-budget-position";
import { getPersonalBudgetStartDay } from "@/lib/personal-budget-period";
import { periodBounds, periodKeyOf } from "@/lib/budget-date-utils";
import { isTaskOpen } from "@/app/dashboard/tasks/recurrence";
import { daysOverdue, getTaskDueDay, sortByUrgency, todayDayNumber } from "@/app/dashboard/tasks/task-due";
import { loadHouseholdSafeToSpend } from "@/lib/household-safe-to-spend";
import { createMoneyFormat } from "@/lib/currency";
import { withCommonUnits } from "@/lib/units";
import { loadIncomingByItem } from "@/lib/incoming-stock";
import { parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { loadMissingIngredients } from "@/app/dashboard/meal-planning/missing-for-range";
import { COOK_PARAM } from "@/app/dashboard/meal-planning/meal-types";
import { SETUP_FULL_CARD_MAX_DONE, pickTargetList, pickUseSoon, summarizePantry } from "@/lib/home-summary";
import { Greeting } from "@/components/dashboard/greeting";
import { WelcomeToast } from "@/components/dashboard/welcome-toast";
import { firstName } from "@/lib/greeting";
import { PageTitle } from "@/components/dashboard/page-title";
import { LazyDialogErrorMessage } from "@/components/ui/lazy-dialog";
import { getActiveBatches } from "@/app/dashboard/meal-planning/prepared-batches";

// UX-70: how many tasks the Today block lists before "N more".
const TODAY_TASK_LIMIT = 5;
// UX-HOME-2: how many "Use soon" chips before "N more".
const USE_SOON_LIMIT = 5;
// UX-HOME-3: how many missing ingredients the Today line names before "N more".
const MISSING_NAMES_LIMIT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

// Home (UX-HOME-1..4, the Oct 2026 redesign; REQUIREMENTS.md "Home"): the
// screen that answers "what needs me now?" in about one phone screen. Three
// cards: Today (dinner, leftovers, tasks), Shopping & pantry, and Safe to
// spend, plus setup while a household is new. On a phone they stack in that
// order; from `lg` Today ("doing") takes the left column and the other two
// ("checking") the right. Everything is loaded here in one parallel batch
// and handed to the cards as plain values.
export default async function DashboardOverviewPage(props: PageProps<"/dashboard">) {
  const [{ household, userId }, dict, locale, searchParams, timeZone] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    props.searchParams,
    getTimeZone(),
  ]);
  // UX-135: set by the verification link's sign-in (verifyEmailAction).
  const showWelcome = searchParams.welcome === "1";

  const now = new Date();
  // Planner dates are UTC midnights (date-utils.ts), so today is the UTC
  // date key, like the planner's own "today".
  const plannerToday = parseDateKey(toDateKey(now));

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
    tonightMissing,
    householdStepSkipped,
    gettingStartedDismissed,
    gettingStartedCelebrated,
    plannedMealCount,
    prepBatches,
    sampleState,
    incomingByItem,
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
        skippedUntil: true,
        dueDate: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    // The columns the stock and expiry summaries read, plus what the "Add
    // to list" dialog offers as names and units — not every inventory
    // column for every item.
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        quantity: true,
        lowStockThreshold: true,
        expiresAt: true,
      },
    }),
    prisma.shoppingList.findMany({
      where: { householdId: household.id, status: "ACTIVE" },
      // The rows still to buy: their count for the list row, which
      // inventory items they restock for the "already on the list" line, and
      // their names, so a missing ingredient already added isn't offered again.
      select: {
        id: true,
        name: true,
        isDefault: true,
        createdAt: true,
        items: { where: { purchased: false }, select: { inventoryItemId: true, name: true } },
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
    // included. See src/lib/personal-budget-position.ts. On the user's own
    // budget month (User.personalBudgetMonthStartDay): today's period, the
    // one Personal Budget opens on. Also the source of the balances under
    // the Safe to spend tiles.
    getPersonalBudgetStartDay(userId).then((startDay) => {
      const { start, end } = periodBounds(periodKeyOf(now, startDay), startDay);
      return loadPersonalBudgetPosition({
        userId,
        monthStart: start,
        monthEnd: end,
        startDay,
        sharedLabel: dict.personalBudget.shared.sharedBadge,
      });
    }),
    // Tonight's dinner. The recipe's steps decide whether it has a cook
    // mode to start.
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId: household.id }, date: plannerToday, mealType: "DINNER" },
      select: {
        freeformName: true,
        portions: true,
        recipe: { select: { id: true, name: true, instructions: true } },
      },
    }),
    // UX-HOME-3: what tonight's recipes need that the pantry hasn't got:
    // the planner's own "Add missing" calculation, for one day's dinner.
    // With no recipe planned it stops after one small query.
    loadMissingIngredients(household.id, { from: plannerToday, to: new Date(plannerToday.getTime() + DAY_MS) }, "DINNER"),
    isHouseholdStepSkipped(household.id),
    isGettingStartedDismissed(household.id),
    isGettingStartedCelebrated(household.id),
    // UX-69: the "Plan this week's meals" step is done once anything is planned.
    prisma.mealPlanEntry.count({ where: { mealPlan: { householdId: household.id } } }),
    getActiveBatches(household.id),
    loadSampleDataState(household.id),
    // Stock ticked off but not put away yet: "Add N" counts it as covered,
    // as the action behind it does.
    loadIncomingByItem(prisma, household.id, now),
  ]);
  const budgetCategoryCount = householdBudget.count;

  // Open tasks first, yours before the household's unassigned ones (stable,
  // so each group keeps its oldest-first order), then by urgency (UX-133):
  // overdue, due today, due later, undated. The sort is stable too, so the
  // order above breaks ties, and the overdue ones are never cut off by the
  // "N more" limit.
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

  // The list everything on Home adds to: "Add N", "Add to list" and the
  // missing ingredients all land on the same one.
  const target = pickTargetList(activeLists);
  const targetRef = target ? { id: target.id, name: target.name } : null;

  // --- Today ---------------------------------------------------------------
  const tonightNames = tonightEntries
    .map((entry) => entry.recipe?.name ?? entry.freeformName)
    .filter((name): name is string => !!name);
  const tonightRecipes = tonightEntries.filter((entry) => entry.recipe);
  // Cook mode is for a recipe with steps (the recipe sheet's own rule).
  const cookable = tonightRecipes.find((entry) => entry.recipe?.instructions?.trim());
  const dinner =
    tonightNames.length > 0
      ? {
          name: tonightNames.join(", "),
          // Portions for the one planned recipe; a freeform meal has none
          // worth naming, and two dinners would need two.
          detail:
            tonightEntries.length === 1 && tonightRecipes.length === 1
              ? format(plural(tonightRecipes[0].portions, dict.dashboard.today.portions), {
                  count: tonightRecipes[0].portions,
                })
              : null,
          cookHref: cookable
            ? `/dashboard/meal-planning?tab=recipes&recipe=${cookable.recipe!.id}&${COOK_PARAM}=1`
            : null,
        }
      : null;
  // Minus what's already waiting on the list Add N fills, matched the way
  // the action dedupes (by inventory item, else by name), so the line goes
  // once its ingredients are on the list rather than offering them again.
  const pendingOnTarget = target?.items ?? [];
  const onTargetIds = new Set(pendingOnTarget.map((row) => row.inventoryItemId).filter(Boolean));
  const onTargetNames = new Set(pendingOnTarget.map((row) => row.name.trim().toLowerCase()));
  const missingItems = tonightMissing.items.filter(
    (item) => !onTargetIds.has(item.key) && !onTargetNames.has(item.name.trim().toLowerCase()),
  );
  const listFormat = new Intl.ListFormat(locale, { type: "conjunction" });
  const missingNames =
    missingItems.length <= MISSING_NAMES_LIMIT
      ? missingItems.map((item) => item.name)
      : [
          ...missingItems.slice(0, MISSING_NAMES_LIMIT - 1).map((item) => item.name),
          format(plural(missingItems.length - (MISSING_NAMES_LIMIT - 1), dict.dashboard.today.missingMore), {
            count: missingItems.length - (MISSING_NAMES_LIMIT - 1),
          }),
        ];
  const missing: TodayMissing | null =
    missingItems.length > 0
      ? {
          text: format(dict.dashboard.today.missing, { names: listFormat.format(missingNames) }),
          rows: missingItems.map((item) => ({
            name: item.name,
            quantity: item.missingQuantity,
            unit: item.unit,
            note: item.note,
          })),
          target: targetRef,
          // What the action names a list it has to start (cooking-actions.ts).
          newListName: datedName(dict.shoppingList.defaultNamePrefix, locale),
        }
      : null;

  // GAP-49: batches still holding portions, soonest eat-by first
  // (getActiveBatches' order). An emptied batch whose last portions are only
  // planned stays on the Prep tab, but here it's nothing left to eat.
  // Formatted in UTC like the Prep tab, so server and browser name one day.
  const prepDayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const leftovers = prepBatches
    .filter((batch) => batch.remainingPortions > 0)
    .slice(0, 3)
    .map((batch) => ({
      id: batch.id,
      name: batch.recipeName,
      detail: [
        format(plural(batch.totalPortions, dict.mealPlanning.prepPortionsLeft), {
          remaining: batch.remainingPortions,
          total: batch.totalPortions,
        }),
        batch.expiryDate
          ? format(dict.mealPlanning.prepEatBy, { day: prepDayFormat.format(new Date(batch.expiryDate)) })
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));

  // --- Shopping & pantry ---------------------------------------------------
  const pendingShoppingItems = activeLists.reduce((sum, list) => sum + list.items.length, 0);
  const onListItemIds = new Set(activeLists.flatMap((list) => list.items.map((row) => row.inventoryItemId)));
  const pantry = summarizePantry(items, {
    onAnyListIds: onListItemIds,
    targetPendingIds: new Set((target?.items ?? []).map((row) => row.inventoryItemId)),
    incomingByItem,
  });
  // UX-71: the warning links to the inventory filtered to what it names.
  const lowHref = pantry.lowCount > 0 ? "/dashboard/inventory?status=low" : "/dashboard/inventory?status=out";
  const useSoon = pickUseSoon(items, now, timeZone, USE_SOON_LIMIT);

  // --- Safe to spend -------------------------------------------------------
  const personalTile =
    personalBudgetCategoryCount > 0
      ? {
          // Personal amounts carry no currency, as on Personal budget.
          amount: createMoneyFormat(locale, null).format(personalPosition.safeToSpend),
          status: personalPosition.safeToSpendStatus,
        }
      : null;
  const householdTile = householdBudget.safeToSpend
    ? {
        amount: createMoneyFormat(locale, household.currencyCode).format(householdBudget.safeToSpend.amount),
        status: householdBudget.safeToSpend.status,
      }
    : null;
  const debts = personalPosition.householdDebts;


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
    // No personal-budget step (UX-69): the "You" tile's "Set up" already is
    // that feature's call to action.
  ];
  const setupDone = gettingStartedSteps.filter((step) => step.done || step.skipped).length;
  // UX-HOME-4: in the first days setup is the one job, so the full card
  // leads the page; once it's a strip it follows the cards.
  const setupFirst = setupDone <= SETUP_FULL_CARD_MAX_DONE;
  const setup = !gettingStartedDismissed && (
    <GettingStarted
      steps={gettingStartedSteps}
      celebrated={gettingStartedCelebrated}
      dict={dict.dashboard.gettingStarted}
    />
  );

  // Today's date as the subtitle, in the user's own time zone (a planning
  // aid: "is it Thursday already?"). Server-rendered, so it can't drift on
  // hydration; capitalised because a Swedish weekday is lowercase.
  const dateLine = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(now);
  const subtitle = dateLine.charAt(0).toLocaleUpperCase(locale) + dateLine.slice(1);

  const sl = dict.shoppingList;

  return (
    // PERF-26: what the lazily loaded "Add to list" dialog says when its
    // chunk can't be fetched.
    <LazyDialogErrorMessage message={dict.errors.generic}>
      <div className="flex flex-col gap-6">
        {showWelcome && (
          <WelcomeToast message={format(dict.dashboard.welcome, { name: firstName(user.displayName) })} />
        )}
        {/* No primary action: Home is a summary that hands off to the
            feature pages. text-balance (inherited by the H1) keeps a long
            greeting from leaving the name alone on the second line. */}
        <div className="min-w-0 text-balance">
          <PageTitle>
            <Greeting name={firstName(user.displayName)} dict={dict.dashboard.greeting} />
          </PageTitle>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>

        {setupFirst && setup}

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            <TodayBlock
              tasks={shownTasks}
              moreTaskCount={openTasks.length - shownTasks.length}
              dinner={dinner}
              missing={missing}
              leftovers={leftovers}
              dict={dict.dashboard.today}
              missingDict={{
                addedToast: dict.mealPlanning.missingIngredientsAddedToast,
                alreadyOnListToast: dict.mealPlanning.missingIngredientsAlreadyOnListToast,
                openList: dict.mealPlanning.openShoppingList,
              }}
              taskDict={{
                toggleCompleteAriaLabel: dict.tasks.toggleCompleteAriaLabel,
                toggleIncompleteAriaLabel: dict.tasks.toggleIncompleteAriaLabel,
                doneToast: dict.tasks.doneToast,
                undo: dict.tasks.swipe.undo,
                saveFailedToast: dict.tasks.saveFailedToast,
                overdueLabel: dict.tasks.overdueLabel,
              }}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <ShoppingPantryCard
              lists={activeLists}
              pendingCount={pendingShoppingItems}
              pantry={pantry}
              hasItems={items.length > 0}
              lowHref={lowHref}
              target={targetRef}
              useSoon={useSoon.shown}
              moreUseSoonCount={useSoon.moreCount}
              // UTC, like pickUseSoon's day: a typed date is a UTC midnight.
              laterDayFormat={new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })}
              dict={dict.dashboard.pantry}
              shoppingDict={{
                addLowStockAddedToast: sl.addLowStockAddedToast,
                addLowStockNoneToast: sl.addLowStockNoneToast,
              }}
              saveFailedToast={dict.errors.generic}
              addToList={
                target && (
                  <HomeAddToList
                    label={dict.dashboard.addToList}
                    listId={target.id}
                    inventoryItems={items.map(({ id, name, category, unit }) => ({ id, name, category, unit }))}
                    units={withCommonUnits([...new Set(items.map((item) => item.unit))].sort())}
                    dict={{
                      add: sl.add,
                      addItem: sl.addItem,
                      addItemDialogTitle: sl.addItemDialogTitle,
                      addItemNamePlaceholder: sl.addItemNamePlaceholder,
                      addItemQuantityAriaLabel: sl.addItemQuantityAriaLabel,
                      addItemUnitPlaceholder: sl.addItemUnitPlaceholder,
                      adding: sl.adding,
                      autoLinkedName: sl.autoLinkedName,
                      needsMappingToast: sl.needsMappingToast,
                      editItem: sl.editItem,
                      comboboxNoMatches: sl.comboboxNoMatches,
                      comboboxAddNew: sl.comboboxAddNew,
                      comboboxClear: sl.comboboxClear,
                      comboboxShowSuggestions: sl.comboboxShowSuggestions,
                    }}
                    barcodeDict={dict.barcodeScanner}
                  />
                )
              }
            />
            {/* Always shown: either the "You" tile has a number, or its "Set
                up" is the personal budget's one call to action on Home
                (UX-69), even for a household with no budget at all. */}
            <SafeToSpendTiles
              personal={personalTile}
              household={householdTile}
              debts={debts}
              showHouseholdName={personalPosition.showHouseholdName}
              numberFormat={createMoneyFormat(locale, null)}
              dict={dict.dashboard.money}
              debtsDict={dict.budget.safeToSpend}
            />
          </div>
        </div>

        {!setupFirst && setup}

        {/* UX-136: opt-in sample data for an empty household, and the way out. */}
        {(sampleState.hasSample || sampleState.isEmpty) && (
          <SampleDataCard mode={sampleState.hasSample ? "clear" : "offer"} dict={dict.dashboard.sampleData} />
        )}
      </div>
    </LazyDialogErrorMessage>
  );
}
