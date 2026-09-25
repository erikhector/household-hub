import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { ExportButton } from "@/components/export/export-button";
import { BudgetTabs } from "@/components/budget/budget-tabs";
import { BudgetOnboarding } from "@/components/budget/budget-onboarding";
import { CategoryManager } from "@/components/budget/category-manager";
import {
  CostAnalyzer,
  type ItemPriceTrend,
  type MonthlySpendPoint,
} from "@/components/budget/cost-analyzer";
import { computeCheapestStoreComparisons } from "@/lib/cheapest-store-calc";
import { FixedBudgetSummary } from "@/components/budget/fixed-budget-summary";
import { HouseholdBalances } from "@/components/budget/household-balances";
import { PeriodSummary, type CategoryTotal } from "@/components/budget/period-summary";
import {
  RecurringTemplatesPanel,
  type PausedRecurringTemplateRow,
  type RecurringTemplateListRow,
} from "@/components/budget/recurring-templates-panel";
import { TransactionList } from "@/components/budget/transaction-list";
import {
  acknowledgeTemplatePeriodAction,
  createRecurringTemplateAction,
  createTransactionAction,
  deleteRecurringTemplateAction,
  deleteTransactionAction,
  logRecurringTemplateAction,
  setRecurringTemplateActiveAction,
  unacknowledgeTemplatePeriodAction,
  updateRecurringTemplateAction,
  updateTransactionAction,
} from "@/app/dashboard/budget/actions";
import { computeSafeToSpend } from "@/lib/safe-to-spend-calc";
import { resolveBudgetHouseholdView } from "@/lib/budget-household-view";
import { ReadOnlyHouseholdBanner } from "@/components/budget/read-only-household-banner";
import {
  computeBudgetBalanceStatus,
  computeFixedMonthlySummary,
  computeRecurringBreakdown,
  computeRecurringMonthlyTotals,
  computeTemplateStatuses,
} from "@/lib/recurring-template-calc";
import {
  addMonths,
  getMonthEnd,
  getMonthStart,
  isMonthKey,
  parseMonthKey,
  toMonthKey,
} from "@/lib/budget-date-utils";
import { computeNetBalances, simplifyDebts } from "./settle-up-calc";
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "./actions";

// An item needs at least this many recorded prices before its trend is
// considered meaningful enough to show — see REQUIREMENTS.md's "Cost
// analyzer" subsection.
const MIN_PRICE_POINTS_FOR_TREND = 3;
// Cap the monthly spending chart to the most recent N months so it stays
// readable once a household has years of price history.
const MAX_SPENDING_MONTHS = 12;
// Same cap, for the "Fixed income & costs" trend chart.
const MAX_FIXED_TREND_MONTHS = 12;
// How far back (in months) computeSafeToSpend and computeTemplateStatuses
// need to see past the month currently being viewed: the former looks for a
// category's most recent `isRecurring` transaction dated *before* that
// month to estimate a bill that hasn't posted yet, and the latter needs a
// YEARLY RecurringTemplate's whole calendar year to tell whether it's
// already been paid (see SCALE-F, BACKLOG.md). 12 months covers every
// WEEKLY/MONTHLY/YEARLY cadence in the common case — a YEARLY template paid
// *later* in the same calendar year than the month being viewed is the one
// edge case this trades away, the same trade-off MAX_FIXED_TREND_MONTHS's
// trailing window already makes for the fixed-cost trend chart below.
const RECURRING_LOOKBACK_MONTHS = 12;

export default async function BudgetPage(props: PageProps<"/dashboard/budget">) {
  const [{ household, userId, households }, dict, locale, searchParams] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    props.searchParams,
  ]);

  const monthParam = searchParams.month;
  const monthParamValue = Array.isArray(monthParam) ? monthParam[0] : monthParam;
  const now = new Date();
  const monthStart = isMonthKey(monthParamValue) ? parseMonthKey(monthParamValue) : getMonthStart(now);
  const monthEnd = getMonthEnd(monthStart);
  const monthKey = toMonthKey(monthStart);

  // F1: "View in {household} Budget" links (from a shared row in Personal
  // Budget) carry an explicit `?household=` so this page shows the bill's
  // *actual* household, which can differ from the "active" one in the
  // session cookie once a user belongs to more than one. The param is only
  // trusted when it names one of the user's own households, and a
  // non-active household is shown read-only, since every budget action
  // writes to the active household. See resolveBudgetHouseholdView.
  const { householdId, householdParam, readOnly } = resolveBudgetHouseholdView({
    param: searchParams.household,
    activeHouseholdId: household.id,
    memberHouseholdIds: households.map((h) => h.id),
  });
  const viewedHouseholdName = households.find((h) => h.id === householdId)?.name ?? household.name;

  // Bounds for the two queries below that need to see further than just the
  // viewed month — see RECURRING_LOOKBACK_MONTHS's and MAX_FIXED_TREND_MONTHS's
  // doc comments above.
  const recurringLookbackStart = addMonths(monthStart, -RECURRING_LOOKBACK_MONTHS);
  const trendMonthStart = getMonthStart(now);
  const trendWindowStart = addMonths(trendMonthStart, -(MAX_FIXED_TREND_MONTHS - 1));
  const trendWindowEnd = getMonthEnd(trendMonthStart);

  const [
    categories,
    monthTransactions,
    recurringLookbackTransactions,
    fixedTrendTransactions,
    householdMembers,
    recurringTemplates,
    recurringTemplateAcks,
  ] = await Promise.all([
      prisma.budgetCategory.findMany({
        where: { householdId },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      }),
      // SCALE-F: the transactions for the month currently being viewed —
      // feeds the transaction list, the period summary's per-category
      // totals and the settle-up balances below. Previously this query had
      // no date filter at all (fetched the household's *entire* transaction
      // history) and the month was filtered down in JS afterward; that grew
      // every month a household kept using the app, independent of how many
      // transactions actually belong to the month being looked at.
      prisma.transaction.findMany({
        where: { householdId, date: { gte: monthStart, lt: monthEnd } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        include: { category: true, splits: true },
      }),
      // A wider trailing window behind monthTransactions, for the two calcs
      // that need to see more than just the viewed month — see
      // RECURRING_LOOKBACK_MONTHS's doc comment above. Narrowed with
      // `select` (rather than `include`) since neither calc needs splits or
      // a full category row, just the category's name.
      prisma.transaction.findMany({
        where: { householdId, date: { gte: recurringLookbackStart, lt: monthEnd } },
        select: {
          categoryId: true,
          category: { select: { name: true } },
          type: true,
          amount: true,
          date: true,
          isRecurring: true,
          recurringTemplateId: true,
        },
        orderBy: { date: "asc" },
      }),
      // The "Fixed income & costs" trend chart (computeRecurringMonthlyTotals
      // below) always shows the same trailing MAX_FIXED_TREND_MONTHS months
      // ending at *today's* month, independent of whichever month is being
      // browsed above via monthStart/monthEnd — so it gets its own window
      // anchored to `now` instead. Filtered to template-linked transactions
      // only, since that calc ignores every transaction without a
      // recurringTemplateId anyway.
      prisma.transaction.findMany({
        where: {
          householdId,
          recurringTemplateId: { not: null },
          date: { gte: trendWindowStart, lt: trendWindowEnd },
        },
        select: { type: true, amount: true, date: true, recurringTemplateId: true },
      }),
      // Fetched for the expense-splitting feature (see REQUIREMENTS.md's
      // "Household expense splitting" subsection) — the split UI and the
      // balances tab are both only offered when a household has more than
      // one member.
      prisma.householdMember.findMany({
        where: { householdId },
        include: { user: { select: { displayName: true } } },
        orderBy: { createdAt: "asc" },
      }),
      // Recurring bill templates — see src/lib/recurring-template-calc.ts and the
      // "Recurring" tab below. `splits` feeds the opt-in template-splitting UI
      // (RecurringTemplateDialog) and the personal budget's "shared with your
      // household" surface — see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md.
      prisma.recurringTemplate.findMany({
        where: { householdId },
        include: { category: true, splits: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.recurringTemplateAck.findMany({
        where: { recurringTemplate: { householdId } },
      }),
    ]);

  const categoryRows = categories.map((c) => ({ id: c.id, name: c.name, type: c.type }));

  const memberOptions = householdMembers.map((m) => ({ id: m.id, displayName: m.user.displayName }));
  const currentMemberId = householdMembers.find((m) => m.userId === userId)?.id ?? "";

  // monthTransactions is already scoped to [monthStart, monthEnd) by the
  // query above — fed to TransactionList, the settlements calc below and
  // totalsByCategory. The fixed-trend/template-status calcs further down
  // each need their own broader window, so they read from
  // recurringLookbackTransactions/fixedTrendTransactions instead (see their
  // query comments above).
  const transactionRows = monthTransactions.map((t) => ({
    id: t.id,
    categoryId: t.categoryId,
    categoryName: t.category.name,
    type: t.type,
    amount: t.amount,
    description: t.description,
    date: t.date,
    isRecurring: t.isRecurring,
    recurrenceFrequency: t.recurrenceFrequency,
    paidByMemberId: t.paidByMemberId,
    splits: t.splits.map((s) => ({ householdMemberId: s.householdMemberId, amountOwed: s.amountOwed })),
  }));

  // --- Household expense splitting: "who owes whom" -----------------------
  // See REQUIREMENTS.md's "Household expense splitting" subsection. Only
  // meaningful once a household has more than one member; all netting/
  // debt-simplification logic lives in settle-up-calc.ts so it's
  // unit-testable without Prisma, same convention as src/lib/safe-to-spend-calc.ts.
  // Scoped to the selected budget month (monthTransactions, same window as
  // PeriodSummary/SafeToSpend) rather than the household's whole history, so
  // balances reset each month instead of accumulating forever.
  const settlements =
    memberOptions.length > 1
      ? simplifyDebts(
          computeNetBalances(
            monthTransactions
              .filter((t) => t.paidByMemberId && t.splits.length > 0)
              .map((t) => ({
                amount: t.amount,
                paidByMemberId: t.paidByMemberId as string,
                splits: t.splits.map((s) => ({
                  householdMemberId: s.householdMemberId,
                  amountOwed: s.amountOwed,
                })),
              })),
          ),
        )
      : [];

  const totalsByCategory = (type: "INCOME" | "EXPENSE" | "SAVINGS"): CategoryTotal[] => {
    const totals = new Map<string, CategoryTotal>();
    for (const t of monthTransactions) {
      if (t.type !== type) continue;
      const existing = totals.get(t.categoryId);
      if (existing) {
        existing.total += t.amount;
      } else {
        totals.set(t.categoryId, { id: t.categoryId, name: t.category.name, total: t.amount });
      }
    }
    return [...totals.values()].sort((a, b) => b.total - a.total);
  };

  const incomeByCategory = totalsByCategory("INCOME");
  const expenseByCategory = totalsByCategory("EXPENSE");
  // Neither income nor a cost (see TransactionType's doc comment in
  // schema.prisma) — tracked separately rather than folded into income or
  // expense below.
  const savingsByCategory = totalsByCategory("SAVINGS");
  const income = incomeByCategory.reduce((sum, c) => sum + c.total, 0);
  const expense = expenseByCategory.reduce((sum, c) => sum + c.total, 0);
  const savings = savingsByCategory.reduce((sum, c) => sum + c.total, 0);

  // --- Safe to spend --------------------------------------------------------
  // See REQUIREMENTS.md's "Safe to spend" subsection: this month's income so
  // far minus expenses so far minus savings so far, minus an estimate of
  // recurring expense categories that haven't posted a transaction yet this
  // month. All pure logic lives in computeSafeToSpend
  // (@/lib/safe-to-spend-calc.ts) so it's unit-testable without Prisma; fed
  // recurringLookbackTransactions (not monthTransactions) since it needs to
  // look further back than the viewed month to find a category's most
  // recent recurring transaction — see RECURRING_LOOKBACK_MONTHS's doc
  // comment above.
  const { safeToSpend, expectedRecurring, status: safeToSpendStatus } = computeSafeToSpend({
    transactions: recurringLookbackTransactions.map((t) => ({
      categoryId: t.categoryId,
      categoryName: t.category.name,
      type: t.type,
      amount: t.amount,
      date: t.date,
      isRecurring: t.isRecurring,
    })),
    monthStart,
    monthEnd,
    incomeSoFar: income,
    expenseSoFar: expense,
    savingsSoFar: savings,
  });

  // --- Recurring templates --------------------------------------------------
  // See src/lib/recurring-template-calc.ts's doc comments for the "accounted for"
  // model. Paused (inactive) templates get their own section in the panel
  // instead of a status, since "due/acknowledged/posted" is meaningless
  // while a template isn't running. Fed recurringLookbackTransactions (not
  // monthTransactions) since a YEARLY template's period can span months
  // outside the one being viewed — see RECURRING_LOOKBACK_MONTHS's doc
  // comment above.
  const activeRecurringTemplates = recurringTemplates.filter((t) => t.active);
  const templateStatusRows = computeTemplateStatuses({
    templates: activeRecurringTemplates,
    transactions: recurringLookbackTransactions.map((t) => ({
      recurringTemplateId: t.recurringTemplateId,
      date: t.date,
    })),
    acks: recurringTemplateAcks,
    referenceDate: monthStart,
    monthEnd,
  });
  const recurringTemplateRows: RecurringTemplateListRow[] = templateStatusRows.map((row) => {
    // F7: who ran "Mark accounted for" for this period, if it was
    // acknowledged rather than posted — resolved from the matching
    // RecurringTemplateAck row's createdByUserId via the household-member
    // list already fetched above, same plain-string-id-to-name lookup
    // InventoryItem.updatedByUserId's UI uses.
    const ack =
      row.status === "acknowledged"
        ? recurringTemplateAcks.find(
            (a) => a.recurringTemplateId === row.template.id && a.periodKey === row.periodKey,
          )
        : undefined;
    const acknowledgedByName = ack?.createdByUserId
      ? (householdMembers.find((m) => m.userId === ack.createdByUserId)?.user.displayName ?? null)
      : null;

    return {
      id: row.template.id,
      name: row.template.name,
      categoryId: row.template.categoryId,
      categoryName: row.template.category.name,
      amount: row.template.amount,
      frequency: row.template.frequency,
      dayOfMonth: row.template.dayOfMonth,
      status: row.status,
      acknowledgedByName,
      splits: row.template.splits.map((s) => ({
        householdMemberId: s.householdMemberId,
        amountOwed: s.amountOwed,
      })),
    };
  });
  const pausedRecurringTemplateRows: PausedRecurringTemplateRow[] = recurringTemplates
    .filter((t) => !t.active)
    .map((t) => ({
      id: t.id,
      name: t.name,
      categoryId: t.categoryId,
      categoryName: t.category.name,
      amount: t.amount,
      frequency: t.frequency,
      dayOfMonth: t.dayOfMonth,
      splits: t.splits.map((s) => ({
        householdMemberId: s.householdMemberId,
        amountOwed: s.amountOwed,
      })),
    }));

  // --- Fixed income & costs summary -----------------------------------------
  // The "core of the budget" headline — see computeFixedMonthlySummary's doc
  // comment. Fed every template (active and paused; the calc filters active
  // itself) rather than just activeRecurringTemplates, so it stays symmetric
  // with computeTemplateStatuses's own internal filtering above. Both calcs
  // also filter out templates created on or after monthEnd internally, so a
  // past month's view doesn't backward-propagate templates that didn't exist
  // yet.
  const fixedMonthlySummary = computeFixedMonthlySummary(recurringTemplates, monthEnd);
  // fixedTrendTransactions's query above already selects exactly this shape
  // and window (trailing MAX_FIXED_TREND_MONTHS months ending at `now`,
  // template-linked only), so it's passed straight through with no mapping.
  const fixedMonthlyTotals = computeRecurringMonthlyTotals({
    transactions: fixedTrendTransactions,
    referenceDate: now,
    monthsBack: MAX_FIXED_TREND_MONTHS,
  });
  // Per-item breakdown behind the totals above, for the proportional-bar
  // visualization of what makes up the fixed budget — same shape/component
  // as PeriodSummary's per-category breakdown (see category-breakdown.tsx).
  const fixedIncomeBreakdown = computeRecurringBreakdown(recurringTemplates, "INCOME", monthEnd).map(
    (item) => ({ id: item.id, name: item.name, total: item.monthlyAmount }),
  );
  const fixedExpenseBreakdown = computeRecurringBreakdown(recurringTemplates, "EXPENSE", monthEnd).map(
    (item) => ({ id: item.id, name: item.name, total: item.monthlyAmount }),
  );
  const budgetBalanceStatus = computeBudgetBalanceStatus(fixedMonthlySummary);

  // --- Cost analyzer aggregation ------------------------------------------
  // Fed from PriceHistory, populated whenever a shopping list item is marked
  // purchased with an estimated price (togglePurchasedAction in
  // src/app/dashboard/shopping-list/actions.ts). All aggregation happens
  // here in the page's Server Component, same convention as the period
  // summary above — CostAnalyzer itself is a plain presentational component.
  // `store` (GAP-6) is optional and mostly null on older rows — it's only
  // ever set when the household typed one in on a receipt scan/register or
  // a manual price correction (see updateShoppingListItemPriceAction).
  const priceHistoryRows = await prisma.priceHistory.findMany({
    where: { inventoryItem: { householdId } },
    include: { inventoryItem: { select: { id: true, name: true } } },
    orderBy: { date: "asc" },
  });

  const monthlyTotals = new Map<string, number>();
  for (const row of priceHistoryRows) {
    const key = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, "0")}`;
    monthlyTotals.set(key, (monthlyTotals.get(key) ?? 0) + row.price);
  }
  const monthlySpending: MonthlySpendPoint[] = [...monthlyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-MAX_SPENDING_MONTHS)
    .map(([month, total]) => ({ month, total }));

  const pointsByItem = new Map<string, ItemPriceTrend>();
  for (const row of priceHistoryRows) {
    const point = { date: row.date, price: row.price };
    const existing = pointsByItem.get(row.inventoryItemId);
    if (existing) {
      existing.points.push(point);
    } else {
      pointsByItem.set(row.inventoryItemId, {
        id: row.inventoryItemId,
        name: row.inventoryItem.name,
        points: [point],
        changePercent: 0,
      });
    }
  }
  // GAP-6: which store was cheapest "last time" for an item bought at ≥2
  // distinct stores — independent of MIN_PRICE_POINTS_FOR_TREND above, since
  // two rows at two different stores is already a meaningful comparison
  // even if it isn't (yet) enough purchase history for a trend line. See
  // computeCheapestStoreComparisons's doc comment for the "last recorded
  // price per store, not lowest ever" rule this follows.
  const storeComparisons = computeCheapestStoreComparisons(
    priceHistoryRows.map((row) => ({
      inventoryItemId: row.inventoryItemId,
      itemName: row.inventoryItem.name,
      price: row.price,
      store: row.store,
      date: row.date,
    })),
  );

  const itemTrends: ItemPriceTrend[] = [...pointsByItem.values()]
    .filter((item) => item.points.length >= MIN_PRICE_POINTS_FOR_TREND)
    .map((item) => {
      const first = item.points[0].price;
      const last = item.points[item.points.length - 1].price;
      const changePercent = first === 0 ? 0 : ((last - first) / first) * 100;
      return { ...item, changePercent };
    })
    .sort((a, b) => b.points.length - a.points.length);

  // --- Manage tab: recurring items + categories -----------------------------
  // Grouped together — both are setup/maintenance actions you reach for far
  // less often than logging a transaction, so they share one tab instead of
  // categories being duplicated across the page (see budget-tabs.tsx's doc
  // comment).
  const manage = (
    <div className="flex flex-col gap-6">
      <RecurringTemplatesPanel
        templates={recurringTemplateRows}
        pausedTemplates={pausedRecurringTemplateRows}
        categories={categoryRows}
        members={memberOptions}
        currentMemberId={currentMemberId}
        monthKey={monthKey}
        dict={dict.budget}
        locale={locale}
        onTogglePause={setRecurringTemplateActiveAction}
        onDelete={deleteRecurringTemplateAction}
        onAcknowledge={acknowledgeTemplatePeriodAction}
        onUnacknowledge={unacknowledgeTemplatePeriodAction}
        createTemplateAction={createRecurringTemplateAction}
        updateTemplateAction={updateRecurringTemplateAction}
        createTransactionAction={createTransactionAction}
        updateTransactionAction={updateTransactionAction}
      />
      <CategoryManager
        categories={categoryRows}
        dict={dict.budget}
        createAction={createCategoryAction}
        updateAction={updateCategoryAction}
        deleteAction={deleteCategoryAction}
      />
    </div>
  );

  const transactionsTab = (
    <div className="flex flex-col gap-6">
      {/* The export route always exports the active household, so it's
          hidden while another household is on screen rather than handing
          back a different household's CSV. */}
      {!readOnly && (
        <div className="flex justify-end">
          <ExportButton href="/dashboard/budget/export" label={dict.export.button} />
        </div>
      )}
      <TransactionList
        transactions={transactionRows}
        categories={categoryRows}
        members={memberOptions}
        currentMemberId={currentMemberId}
        dict={dict.budget}
        locale={locale}
        onDelete={deleteTransactionAction}
        createAction={createTransactionAction}
        updateAction={updateTransactionAction}
      />
    </div>
  );

  // Selected month's income/expense/savings breakdown — shown on both
  // Overview (so it's visible the moment you flip months, without switching
  // tabs) and Insights (its original home, for the fuller analysis context).
  const periodSummary = (
    <PeriodSummary
      income={income}
      expense={expense}
      savings={savings}
      incomeByCategory={incomeByCategory}
      expenseByCategory={expenseByCategory}
      savingsByCategory={savingsByCategory}
      dict={dict.budget.summary}
      locale={locale}
    />
  );

  const insights = (
    <div className="flex flex-col gap-6">
      {periodSummary}
      <FixedBudgetSummary
        monthlyIncome={fixedMonthlySummary.monthlyIncome}
        monthlyExpense={fixedMonthlySummary.monthlyExpense}
        monthlySavings={fixedMonthlySummary.monthlySavings}
        monthlyTotals={fixedMonthlyTotals}
        balanceStatus={budgetBalanceStatus}
        incomeBreakdown={fixedIncomeBreakdown}
        expenseBreakdown={fixedExpenseBreakdown}
        dict={dict.budget.fixedSummary}
        locale={locale}
      />
      <CostAnalyzer
        monthlySpending={monthlySpending}
        itemTrends={itemTrends}
        storeComparisons={storeComparisons}
        dict={dict.budget.costAnalyzer}
        locale={locale}
      />
      {memberOptions.length > 1 && (
        <HouseholdBalances
          settlements={settlements}
          members={memberOptions}
          dict={dict.budget.balances}
          locale={locale}
        />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.budget.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.budget.subtitle}</p>
      </div>

      {readOnly && (
        <ReadOnlyHouseholdBanner
          householdId={householdId}
          householdName={viewedHouseholdName}
          activeHouseholdName={household.name}
          returnTo={`/dashboard/budget?month=${monthKey}`}
          dict={dict.budget.readOnlyHousehold}
        />
      )}

      <BudgetTabs
        dict={dict.budget}
        locale={locale}
        monthKey={monthKey}
        basePath="/dashboard/budget"
        householdParam={householdParam}
        readOnly={readOnly}
        categories={categoryRows}
        safeToSpendAmount={safeToSpend}
        safeToSpendStatus={safeToSpendStatus}
        safeToSpendExpectedRecurring={expectedRecurring}
        dueTemplates={recurringTemplateRows.filter((r) => r.status === "due")}
        hasRecurringTemplates={recurringTemplateRows.length > 0}
        members={memberOptions}
        currentMemberId={currentMemberId}
        createTransactionAction={createTransactionAction}
        updateTransactionAction={updateTransactionAction}
        onAcknowledgeTemplate={acknowledgeTemplatePeriodAction}
        onLogTemplateAsIs={logRecurringTemplateAction}
        periodSummary={periodSummary}
        onboarding={<BudgetOnboarding dict={dict.budget} createCategoryAction={createCategoryAction} />}
        manage={manage}
        transactions={transactionsTab}
        insights={insights}
      />
    </div>
  );
}
