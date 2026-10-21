import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale, type Dictionary, type Locale } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { ExportButton } from "@/components/export/export-button";
import { BudgetTabs } from "@/components/budget/budget-tabs";
import { BudgetOnboarding } from "@/components/budget/budget-onboarding";
import { CategoryManager } from "@/components/budget/category-manager";
import {
  CostAnalyzer,
  type ItemPriceTrend,
  type MonthlySpendPoint,
} from "@/components/budget/cost-analyzer";
import {
  computeBasketStoreComparison,
  computeCheapestStoreComparisons,
} from "@/lib/cheapest-store-calc";
import { computeExpiredWaste } from "@/lib/inventory/expired-waste";
import { computeStockValue } from "@/lib/inventory/stock-value";
import { FixedBudgetSummary } from "@/components/budget/fixed-budget-summary";
import {
  HouseholdBalances,
  type RepaymentRow,
  type UnpaidBillRow,
} from "@/components/budget/household-balances";
import { PeriodSummary, type CategoryTotal } from "@/components/budget/period-summary";
import { SavingsGoals } from "@/components/budget/savings-goals";
import { savingsGoalRows } from "@/lib/savings-goal-calc";
import { categoriesNearLimit, withCategoryLimits } from "@/lib/budget-category-limit";
import { withCategoryRollover } from "@/lib/budget-rollover-calc";
import {
  RecurringTemplatesPanel,
  type PausedRecurringTemplateRow,
  type RecurringTemplateListRow,
} from "@/components/budget/recurring-templates-panel";
import { TransactionList } from "@/components/budget/transaction-list";
import { localDateKey } from "@/lib/budget-transaction-days";
import { budgetHref, resolveCategoryFilter } from "@/lib/budget-url";
import { RECENT_CATEGORY_SAMPLE, recentCategoryIds } from "@/lib/recent-categories";
import {
  PlannedExpensesPanel,
  type PlannedExpenseRow,
} from "@/components/budget/planned-expenses-panel";
import {
  createPlannedExpenseAction,
  deletePlannedExpenseAction,
  updatePlannedExpenseAction,
} from "@/app/dashboard/budget/planned-expense-actions";
import { getPlannedExpenseStatus, isPlannedItemCounted, plannedItemType } from "@/lib/planned-expense-calc";
import {
  acknowledgeTemplatePeriodAction,
  createRecurringTemplateAction,
  createTransactionAction,
  deleteRecurringTemplateAction,
  deleteSettlementAction,
  deleteTransactionAction,
  logRecurringTemplateAction,
  recordSettlementAction,
  setRecurringTemplateActiveAction,
  unacknowledgeTemplatePeriodAction,
  updateRecurringTemplateAction,
  updateTransactionAction,
} from "@/app/dashboard/budget/actions";
import { computeSafeToSpend } from "@/lib/safe-to-spend-calc";
import { dailyAllowance, projectMonthEnd, withSpendHistory } from "@/lib/chart-calc";
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
import { computeNetBalances, remainingDue, simplifyDebts } from "@/lib/settle-up-calc";
import { swishNumbersForPayer } from "@/lib/swish";
import { HOUSEHOLD_BASE_CURRENCY } from "@/lib/currency";
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "./actions";
import { PageTitle } from "@/components/dashboard/page-title";

// An item needs at least this many recorded prices before its trend is
// considered meaningful enough to show — see REQUIREMENTS.md's "Cost
// analyzer" subsection.
const MIN_PRICE_POINTS_FOR_TREND = 3;
// Cap the monthly spending chart to the most recent N months so it stays
// readable once a household has years of price history.
const MAX_SPENDING_MONTHS = 12;
// PERF-12: how far back the cost analyzer reads PriceHistory — the current
// month plus the 11 before it, which is exactly the spending chart's span.
const PRICE_HISTORY_WINDOW_MONTHS = MAX_SPENDING_MONTHS;
// Same cap, for the "Fixed income & costs" trend chart.
const MAX_FIXED_TREND_MONTHS = 12;
// How many recorded repayments the Balances card lists (newest first) — enough
// to spot and undo a recent mistake without the card growing forever.
const MAX_REPAYMENTS_SHOWN = 10;
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
// GAP-21's category rollover reads the same window: its carry never reaches
// further back than January of the viewed month's year (at most 11 months;
// see src/lib/budget-rollover-calc.ts), so it needs no query of its own.
const RECURRING_LOOKBACK_MONTHS = 12;

// SCALE-J: the cost analyzer (PriceHistory, below) is the one section of
// this page with no data dependency on anything BudgetTabsSection computes
// — it doesn't touch Transaction, RecurringTemplate or HouseholdMember at
// all — so it gets its own Suspense boundary/query instead of sitting in
// BudgetTabsSection's Promise.all. Previously it was fetched with a plain
// `await` *after* that Promise.all resolved (see git history), so a slow
// PriceHistory query added its own latency on top of every other query's
// instead of overlapping with them; isolating it here both runs it
// concurrently with BudgetTabsSection's own fetch and, since it's read by
// only this one component, lets Insights render everything else the moment
// BudgetTabsSection's own data is ready without waiting on this query too.
async function CostAnalyzerSection({
  householdId,
  dict,
  locale,
  currencyCode,
}: {
  householdId: string;
  dict: Dictionary["budget"]["costAnalyzer"];
  locale: Locale;
  currencyCode: string | null;
}) {
  // `store` (GAP-6) is optional and mostly null on older rows — it's only
  // ever set when the household typed one in on a receipt scan/register
  // (see applyReceiptScanAction/registerReceiptAction).
  //
  // GAP-17: alongside it, items whose expiry date fell in this or last
  // month and has already passed — the only rows computeExpiredWaste can
  // ever count. Same Suspense boundary and household scope rather than its
  // own section, since it's one small read on InventoryItem.
  //
  // GAP-33: and every item currently in stock, for the "on hand now" value
  // shown next to it — two columns per row, same scope again.
  //
  // GAP-34: and the inventory ids of every unchecked row on the household's
  // ACTIVE lists — the "basket" the whole-list store comparison prices.
  // Only the ids: the prices come from priceHistoryRows, already fetched.
  const now = new Date();
  const thisMonthStart = getMonthStart(now);
  const lastMonthStart = addMonths(thisMonthStart, -1);
  const priceHistoryWindowStart = addMonths(thisMonthStart, -(PRICE_HISTORY_WINDOW_MONTHS - 1));
  const [priceHistoryRows, expiredCandidates, inStockItems, pendingListItems] = await Promise.all([
    // PERF-12: only the trailing PRICE_HISTORY_WINDOW_MONTHS, not every
    // purchase since the household started. Every figure below is "recent"
    // by definition (the spending bars show 12 months, a trend is first →
    // latest price, a store comparison the last price per store), so older
    // rows only made this query, and the JS passes over it, grow forever.
    prisma.priceHistory.findMany({
      where: { inventoryItem: { householdId }, date: { gte: priceHistoryWindowStart } },
      include: { inventoryItem: { select: { id: true, name: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.inventoryItem.findMany({
      where: { householdId, expiresAt: { gte: lastMonthStart, lt: now } },
      select: {
        id: true,
        name: true,
        quantity: true,
        expiresAt: true,
        expiresAtEstimated: true,
        lastKnownPrice: true,
        updatedAt: true,
      },
    }),
    prisma.inventoryItem.findMany({
      where: { householdId, quantity: { gt: 0 } },
      select: { quantity: true, lastKnownPrice: true },
    }),
    prisma.shoppingListItem.findMany({
      where: {
        purchased: false,
        inventoryItemId: { not: null },
        shoppingList: { householdId, status: "ACTIVE" },
      },
      select: { inventoryItemId: true },
    }),
  ]);
  // This month is the recap itself, last month one line of context — no
  // further back, since the snapshot it's derived from decays (a restock
  // re-estimates the date; see expired-waste.ts's doc comment).
  const expiredThisMonth = computeExpiredWaste(expiredCandidates, thisMonthStart, getMonthEnd(now), now);
  const expiredLastMonth = computeExpiredWaste(expiredCandidates, lastMonthStart, thisMonthStart, now);
  const stockValue = computeStockValue(inStockItems);

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
  const storeRows = priceHistoryRows.map((row) => ({
    inventoryItemId: row.inventoryItemId,
    itemName: row.inventoryItem.name,
    price: row.price,
    store: row.store,
    date: row.date,
  }));
  const storeComparisons = computeCheapestStoreComparisons(storeRows);
  // GAP-34: the same rows, summed per store over what's on the list right
  // now. null (→ empty state) under MIN_BASKET_ITEMS qualifying items.
  const basketComparison = computeBasketStoreComparison(
    storeRows,
    pendingListItems.flatMap((item) => (item.inventoryItemId ? [item.inventoryItemId] : [])),
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

  return (
    <CostAnalyzer
      monthlySpending={monthlySpending}
      itemTrends={itemTrends}
      storeComparisons={storeComparisons}
      basketComparison={basketComparison}
      expiredThisMonth={expiredThisMonth}
      expiredLastMonth={expiredLastMonth}
      stockValue={stockValue}
      dict={dict}
      locale={locale}
      currencyCode={currencyCode}
    />
  );
}

function CostAnalyzerSkeleton({ label }: { label: string }) {
  return (
    <div className="flex animate-pulse flex-col gap-4" role="status" aria-label={label}>
      <div className="list-bleed h-40 rounded-lg border bg-muted/40" />
      <div className="list-bleed grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg border bg-muted/40" />
        ))}
      </div>
    </div>
  );
}

// PERF-12: the split bills the Balances card and "left due" list can still
// need — every bill that isn't settled. One grouped query finds their ids,
// then a plain findMany loads them (with the fields the settle-up calc
// needs) newest first, so the work scales with bills still open rather than
// with every bill the household ever split. The HAVING clause is the exact
// negation of isSettledBill (src/lib/settle-up-calc.ts), which is unit-tested
// to prove leaving settled bills out can't change a balance: some member's
// payment differs from their share, or the bill's amount isn't covered by the
// payments by more than the calc's 0.005 EPSILON. Scoped by the household id
// from the session, bound as a parameter.
async function loadUnsettledSplitBills(householdId: string) {
  const unsettled = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t."id"
    FROM "Transaction" t
    JOIN "TransactionSplit" s ON s."transactionId" = t."id"
    WHERE t."householdId" = ${householdId}
    GROUP BY t."id", t."amount"
    HAVING bool_or(s."amountPaid" <> s."amountOwed")
        OR t."amount" - sum(s."amountPaid") > 0.005
  `;
  if (unsettled.length === 0) return [];
  return prisma.transaction.findMany({
    where: { householdId, id: { in: unsettled.map((row) => row.id) } },
    select: {
      id: true,
      amount: true,
      date: true,
      description: true,
      category: { select: { name: true } },
      splits: { select: { householdMemberId: true, amountOwed: true, amountPaid: true } },
    },
    orderBy: { date: "desc" },
  });
}

// SCALE-J: everything else on this page — Overview's Safe to spend/due
// widget, Manage's recurring templates + categories, the Transactions tab
// and Insights' period summary/fixed-cost trend/balances — funnels into one
// client component (BudgetTabs) that needs categories/safeToSpend/
// dueTemplates/members as plain props (not further Suspense-streamable
// ReactNode) to decide what to render at all, so unlike the cost analyzer
// above there's no clean way to split these into independently-streamed
// pieces without restructuring BudgetTabs itself (shared with the personal
// budget page) into accepting every one of those as its own Suspense slot —
// judged not worth the risk/complexity for this pass. They're kept together
// in one Suspense boundary instead, still a real win over the previous
// all-or-nothing page: the static title above and the read-only banner (no
// DB dependency, see BudgetPage) now render immediately, and this section's
// own query batch runs concurrently with CostAnalyzerSection's instead of
// blocking on it.
async function BudgetTabsSection({
  householdId,
  userId,
  dict,
  locale,
  currencyCode,
  monthStart,
  monthEnd,
  monthKey,
  recurringLookbackStart,
  trendWindowStart,
  trendWindowEnd,
  now,
  readOnly,
  canChangeCurrency,
  householdParam,
  householdName,
}: {
  householdId: string;
  userId: string;
  dict: Dictionary;
  locale: Locale;
  // GAP-13: the *viewed* household's display currency (see BudgetPage).
  currencyCode: string | null;
  monthStart: Date;
  monthEnd: Date;
  monthKey: string;
  recurringLookbackStart: Date;
  trendWindowStart: Date;
  trendWindowEnd: Date;
  now: Date;
  readOnly: boolean;
  // UX-73: owner of the household on screen, and not in F1's read-only view.
  canChangeCurrency: boolean;
  householdParam: string | undefined;
  // UX-110: the viewed household's name, for the onboarding copy.
  householdName: string;
}) {
  const [
    categories,
    monthTransactions,
    recurringLookbackTransactions,
    fixedTrendTransactions,
    householdMembers,
    recurringTemplates,
    recurringTemplateAcks,
    splitTransactions,
    memberSettlements,
    memberSettlementSums,
    savingsTotals,
    plannedExpenses,
    latestTransactions,
  ] = await Promise.all([
      prisma.budgetCategory.findMany({
        where: { householdId },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      }),
      // SCALE-F: the transactions for the month currently being viewed —
      // feeds the transaction list and the period summary's per-category
      // totals (the settle-up balances read splitTransactions instead, since
      // debts carry over between months). Previously this query had
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
        // swishNumber: GAP-7's "Pay with Swish" link — filtered down to just
        // the payees the signed-in member owes (swishNumbersForPayer) before
        // anything reaches the client.
        include: { user: { select: { displayName: true, swishNumber: true } } },
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
      // Every split bill that can still matter, for the Balances card and
      // the "left due" list: debts carry over between months until a
      // repayment clears them, so this can't be limited to the viewed month
      // the way monthTransactions is. PERF-12: but a bill that is fully
      // settled (see isSettledBill) contributes nothing to either, so only
      // the others are loaded, however many bills the household has ever
      // split. See loadUnsettledSplitBills.
      loadUnsettledSplitBills(householdId),
      // PERF-12: only the newest few repayments are listed; the balances
      // need every one but only as a sum per (payer, receiver) pair, so that
      // comes from a groupBy (≤ members² rows) instead of every row.
      prisma.memberSettlement.findMany({
        where: { householdId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: MAX_REPAYMENTS_SHOWN,
      }),
      prisma.memberSettlement.groupBy({
        by: ["fromMemberId", "toMemberId"],
        where: { householdId },
        _sum: { amount: true },
      }),
      // GAP-22: each category's all-time savings, for the Savings goals
      // card. A goal is a running total towards a destination, so unlike
      // monthTransactions this ignores the viewed month entirely — and is
      // summed in the database, so it stays one row per category however
      // long a household keeps saving.
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { householdId, type: "SAVINGS" },
        _sum: { amount: true },
      }),
      // Planned bills (BUDGET-8): every unpaid one, plus those paid on or
      // after the viewed month's start. A bill paid before it is history and
      // left out, so this doesn't grow with every bill ever paid. Status is
      // worked out per viewed month below (getPlannedExpenseStatus).
      prisma.plannedExpense.findMany({
        where: {
          householdId,
          OR: [
            { transaction: { is: null } },
            { transaction: { is: { date: { gte: monthStart } } } },
          ],
        },
        include: { category: true, splits: true, transaction: { select: { date: true } } },
        orderBy: { dueDate: "asc" },
      }),
      // UX-109: what was logged last, whatever month is on screen, so the
      // Add transaction sheet can lead with those categories. By when it was
      // logged, not the transaction's date: backdating a bill is still
      // "the category I just used".
      prisma.transaction.findMany({
        where: { householdId },
        orderBy: { createdAt: "desc" },
        take: RECENT_CATEGORY_SAMPLE,
        select: { categoryId: true },
      }),
    ]);

  const categoryRows = categories.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    monthlyLimit: c.monthlyLimit,
    rolloverEnabled: c.rolloverEnabled,
    goalAmount: c.goalAmount,
    goalDate: c.goalDate,
  }));

  const memberOptions = householdMembers.map((m) => ({ id: m.id, displayName: m.user.displayName }));
  const currentMemberId = householdMembers.find((m) => m.userId === userId)?.id ?? "";

  // monthTransactions is already scoped to [monthStart, monthEnd) by the
  // query above — fed to TransactionList and totalsByCategory. The
  // fixed-trend/template-status calcs and the settle-up balances further
  // down each need their own broader window, so they read from
  // recurringLookbackTransactions/fixedTrendTransactions/splitTransactions
  // instead (see their query comments above).
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
    splits: t.splits.map((s) => ({
      householdMemberId: s.householdMemberId,
      amountOwed: s.amountOwed,
      amountPaid: s.amountPaid,
    })),
  }));

  // --- Household expense splitting: "who owes whom" -----------------------
  // See REQUIREMENTS.md's "Household expense splitting" subsection. Only
  // meaningful once a household has more than one member; all netting/
  // debt-simplification logic lives in src/lib/settle-up-calc.ts so it's
  // unit-testable without Prisma, same convention as src/lib/safe-to-spend-calc.ts.
  // Covers every split bill and repayment the household has (see
  // splitTransactions's query comment), not just the viewed month: a debt
  // carries over until it's cleared instead of silently resetting each month.
  const hasSplitting = memberOptions.length > 1;
  const settlements = hasSplitting
    ? simplifyDebts(
        computeNetBalances(
          splitTransactions.map((t) => ({ amount: t.amount, splits: t.splits })),
          memberSettlementSums.map((m) => ({
            fromMemberId: m.fromMemberId,
            toMemberId: m.toMemberId,
            amount: m._sum.amount ?? 0,
          })),
        ),
      )
    : [];
  // GAP-7: Swish numbers for the transfers the signed-in member has to pay.
  // Swish only moves SEK. A household that has picked a display currency
  // (GAP-13) is taken at its word, so the link disappears for anything but
  // SEK; one that hasn't keeps the pre-GAP-13 assumption that amounts are in
  // HOUSEHOLD_BASE_CURRENCY, so the link still shows exactly as before.
  const swishNumbers = swishNumbersForPayer({
    settlements,
    payerMemberId: currentMemberId,
    members: householdMembers.map((m) => ({ id: m.id, swishNumber: m.user.swishNumber })),
    currencyCode: currencyCode ?? HOUSEHOLD_BASE_CURRENCY,
  });
  const unpaidBills: UnpaidBillRow[] = splitTransactions
    .map((t) => ({
      id: t.id,
      name: t.description || t.category.name,
      date: t.date,
      leftDue: remainingDue({ amount: t.amount, splits: t.splits }),
    }))
    .filter((t) => t.leftDue > 0);
  const repayments: RepaymentRow[] = memberSettlements.map((m) => ({
    id: m.id,
    fromMemberId: m.fromMemberId,
    toMemberId: m.toMemberId,
    amount: m.amount,
    date: m.date,
  }));

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

  // --- Planned bills (BUDGET-8) ---------------------------------------------
  const plannedExpenseRows: PlannedExpenseRow[] = plannedExpenses.map((p) => ({
    id: p.id,
    name: p.name,
    amount: p.amount,
    dueDate: p.dueDate,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    type: plannedItemType(p.category.type),
    status: getPlannedExpenseStatus(
      { dueDate: p.dueDate, paidAt: p.transaction?.date ?? null },
      monthStart,
      monthEnd,
    ),
    paidAt: p.transaction?.date ?? null,
    splits: p.splits.map((s) => ({ householdMemberId: s.householdMemberId, amountOwed: s.amountOwed })),
  }));

  // --- Safe to spend --------------------------------------------------------
  // "Remaining after expenses and savings" — see REQUIREMENTS.md's "Safe to
  // spend" subsection: this month's income so far minus expenses and
  // savings so far, minus every recurring item (bill or saving) still due
  // this month, plus the older transaction-based estimate for categories
  // without a recurring item. All pure logic lives in computeSafeToSpend
  // (@/lib/safe-to-spend-calc.ts) so it's unit-testable without Prisma; fed
  // recurringLookbackTransactions (not monthTransactions) since that estimate
  // needs to look further back than the viewed month to find a category's
  // most recent recurring transaction — see RECURRING_LOOKBACK_MONTHS's doc
  // comment above.
  const {
    safeToSpend,
    breakdown: safeToSpendBreakdown,
    expectedRecurring,
    status: safeToSpendStatus,
  } = computeSafeToSpend({
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
    templates: templateStatusRows.map((row) => ({
      id: row.template.id,
      name: row.template.name,
      categoryId: row.template.categoryId,
      type: row.template.type,
      amount: row.template.amount,
      status: row.status,
    })),
    plannedExpenses: plannedExpenseRows.map(({ id, name, amount, status, type }) => ({
      id,
      name,
      amount,
      status,
      type,
    })),
  });
  // UX-39: where that number lands at month end at this month's everyday
  // pace — null unless the viewed month is the current one.
  const safeToSpendProjection = projectMonthEnd({
    safeToSpend,
    transactions: monthTransactions,
    monthStart,
    today: now,
  });
  const safeToSpendDaily = dailyAllowance({ safeToSpend, monthStart, today: now });
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
        currencyCode={currencyCode}
        onTogglePause={setRecurringTemplateActiveAction}
        onDelete={deleteRecurringTemplateAction}
        onAcknowledge={acknowledgeTemplatePeriodAction}
        onUnacknowledge={unacknowledgeTemplatePeriodAction}
        createTemplateAction={createRecurringTemplateAction}
        updateTemplateAction={updateRecurringTemplateAction}
        createTransactionAction={createTransactionAction}
        updateTransactionAction={updateTransactionAction}
      />
      {(["EXPENSE", "INCOME"] as const).map((kind) => (
        <PlannedExpensesPanel
          key={kind}
          kind={kind}
          rows={plannedExpenseRows.filter((r) => r.type === kind)}
          categories={categoryRows}
          members={memberOptions}
          currentMemberId={currentMemberId}
          monthKey={monthKey}
          dict={dict.budget}
          locale={locale}
          currencyCode={currencyCode}
          createAction={createPlannedExpenseAction}
          updateAction={updatePlannedExpenseAction}
          onDelete={deletePlannedExpenseAction}
          createTransactionAction={createTransactionAction}
          updateTransactionAction={updateTransactionAction}
        />
      ))}
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
      <TransactionList
        transactions={transactionRows}
        categories={categoryRows}
        members={memberOptions}
        currentMemberId={currentMemberId}
        dict={dict.budget}
        locale={locale}
        currencyCode={currencyCode}
        todayKey={localDateKey(now)}
        onDelete={deleteTransactionAction}
        createAction={createTransactionAction}
        updateAction={updateTransactionAction}
        readOnly={readOnly}
      />
      {/* Below the list (phone pass, Oct 2026): exporting is rare, and at
          the top it was the first thing on the tab, above the rows people
          came for. The export route always exports the active household,
          so it's hidden while another household is on screen rather than
          handing back a different household's CSV. */}
      {!readOnly && (
        <div className="flex justify-start">
          <ExportButton href="/dashboard/budget/export" label={dict.export.button} />
        </div>
      )}
    </div>
  );

  // UX-108: the rows Insights draws "Expenses by category" from, also what
  // the Overview's near-or-over-limit list reads, so both agree. GAP-12
  // limits, GAP-21 rollover (read from the lookback window rather than
  // monthTransactions), UX-39 sparkline history.
  const expenseRows = withSpendHistory(
    withCategoryRollover(
      withCategoryLimits(expenseByCategory, categories),
      categories,
      recurringLookbackTransactions,
      monthStart,
    ),
    recurringLookbackTransactions,
    monthStart,
  );
  const limitAlerts = categoriesNearLimit(expenseRows).map((alert) => ({
    ...alert,
    href: resolveCategoryFilter(alert.id, categoryRows)
      ? budgetHref("/dashboard/budget", { month: monthKey, household: householdParam, tab: "transactions", category: alert.id })
      : null,
  }));

  // Selected month's income/expense/savings breakdown, on Insights. It used
  // to sit on Overview too, where it repeated Safe to spend's totals as four
  // more stat cards (phone pass, Oct 2026).
  const periodSummary = (
    <PeriodSummary
      income={income}
      expense={expense}
      savings={savings}
      remaining={safeToSpend}
      incomeByCategory={incomeByCategory}
      // GAP-12: attach each category's monthly limit (and add capped
      // categories with nothing spent yet) for the capped-bar rendering.
      // Kept out of expenseByCategory itself, which also feeds the
      // expense total above. GAP-21: rollover-enabled rows then get their
      // carried balance from earlier months, read from the lookback window
      // (see RECURRING_LOOKBACK_MONTHS) rather than monthTransactions.
      // UX-39: each row's sparkline comes from the same window.
      expenseByCategory={expenseRows}
      monthStart={monthStart}
      savingsByCategory={savingsByCategory}
      // P3: each of the viewer's own categories drills into Transactions,
      // filtered to it, for the same month.
      categoryHref={(id) =>
        resolveCategoryFilter(id, categoryRows)
          ? budgetHref("/dashboard/budget", { month: monthKey, household: householdParam, tab: "transactions", category: id })
          : null
      }
      dict={dict.budget.summary}
      locale={locale}
      currencyCode={currencyCode}
    />
  );

  // GAP-22: progress towards each SAVINGS category's goal, as of today
  // (`now`, not the viewed month — see SavingsGoals's doc comment).
  const savingsGoals = (
    <SavingsGoals
      goals={savingsGoalRows(
        categories,
        new Map(savingsTotals.map((row) => [row.categoryId, row._sum.amount ?? 0])),
        now,
      )}
      dict={dict.budget.savingsGoals}
      locale={locale}
      currencyCode={currencyCode}
    />
  );

  // UX-114: who owes whom is the one thing on Insights somebody has to act
  // on (it carries "Clear debt"), so when there is a debt it leads the tab
  // instead of sitting under every chart. With nothing owed it stays last,
  // where it's just a record (and the repayment form).
  const hasDebt = settlements.length > 0 || unpaidBills.length > 0;
  const balances = hasSplitting ? (
    <HouseholdBalances
      settlements={settlements}
      unpaidBills={unpaidBills}
      repayments={repayments}
      members={memberOptions}
      currentMemberId={currentMemberId}
      swishNumbers={swishNumbers}
      dict={dict.budget.balances}
      locale={locale}
      currencyCode={currencyCode}
      onRecordRepayment={recordSettlementAction}
      onDeleteRepayment={deleteSettlementAction}
    />
  ) : null;
  const insights = (
    <div className="flex flex-col gap-6">
      {hasDebt && balances}
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
        currencyCode={currencyCode}
      />
      {/* SCALE-J: its own Suspense boundary/query — see CostAnalyzerSection's
          doc comment above. */}
      <Suspense fallback={<CostAnalyzerSkeleton label={dict.common.loading} />}>
        <CostAnalyzerSection
          householdId={householdId}
          dict={dict.budget.costAnalyzer}
          locale={locale}
          currencyCode={currencyCode}
        />
      </Suspense>
      {!hasDebt && balances}
    </div>
  );

  return (
    <BudgetTabs
      dict={dict.budget}
      locale={locale}
      currencyCode={currencyCode}
      monthKey={monthKey}
      currentMonthKey={toMonthKey(now)}
      basePath="/dashboard/budget"
      householdParam={householdParam}
      readOnly={readOnly}
      categories={categoryRows}
      safeToSpendAmount={safeToSpend}
      safeToSpendStatus={safeToSpendStatus}
      safeToSpendBreakdown={safeToSpendBreakdown}
      safeToSpendExpectedRecurring={expectedRecurring}
      safeToSpendProjection={safeToSpendProjection}
      safeToSpendDaily={safeToSpendDaily}
      limitAlerts={limitAlerts}
      dueTemplates={recurringTemplateRows.filter((r) => r.status === "due")}
      hasRecurringTemplates={recurringTemplateRows.length > 0}
      plannedDue={plannedExpenseRows.filter((r) => isPlannedItemCounted(r.status, r.type))}
      members={memberOptions}
      currentMemberId={currentMemberId}
      createTransactionAction={createTransactionAction}
      updateTransactionAction={updateTransactionAction}
      deleteTransactionAction={deleteTransactionAction}
      recentCategoryIds={recentCategoryIds(latestTransactions)}
      onAcknowledgeTemplate={acknowledgeTemplatePeriodAction}
      onLogTemplateAsIs={logRecurringTemplateAction}
      savingsGoals={savingsGoals}
      onboarding={<BudgetOnboarding
          dict={dict.budget}
          currencyDict={dict.household.currency}
          locale={locale}
          currencyCode={currencyCode}
          canChangeCurrency={canChangeCurrency}
          householdName={householdName}
          createCategoryAction={createCategoryAction}
        />}
      manage={manage}
      transactions={transactionsTab}
      insights={insights}
    />
  );
}

// Mirrors the tab bar (MonthNavigator + pill buttons) BudgetTabs renders
// once loaded, so the skeleton doesn't jump the page's layout when the real
// content swaps in.
function BudgetTabsSkeleton({ label }: { label: string }) {
  return (
    <div className="flex animate-pulse flex-col gap-6" role="status" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <div className="h-9 w-9 rounded-md bg-muted" />
        <div className="h-6 w-32 rounded-md bg-muted" />
        <div className="h-9 w-9 rounded-md bg-muted" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="h-9 w-64 rounded-md bg-muted" />
        <div className="h-9 w-32 rounded-md bg-muted" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border bg-muted/40" />
        ))}
      </div>
    </div>
  );
}

export default async function BudgetPage(props: PageProps<"/dashboard/budget">) {
  const [{ household, userId, role, households }, dict, locale, searchParams] = await Promise.all([
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
  // writes to the active household. See resolveBudgetHouseholdView. Pure
  // (no DB) — resolved from `households`, already in hand from
  // requireHousehold() above — so the banner below renders immediately,
  // without waiting on BudgetTabsSection's own query batch.
  const { householdId, householdParam, readOnly } = resolveBudgetHouseholdView({
    param: searchParams.household,
    activeHouseholdId: household.id,
    memberHouseholdIds: households.map((h) => h.id),
  });
  const viewedHousehold = households.find((h) => h.id === householdId);
  const viewedHouseholdName = viewedHousehold?.name ?? household.name;
  // GAP-13: amounts carry the currency of the household on screen, which
  // is not the active one in F1's read-only view.
  const currencyCode = viewedHousehold ? viewedHousehold.currencyCode : household.currencyCode;

  // Bounds for two of BudgetTabsSection's queries that need to see further
  // than just the viewed month — see RECURRING_LOOKBACK_MONTHS's and
  // MAX_FIXED_TREND_MONTHS's doc comments above. Computed here (pure, no DB)
  // so BudgetTabsSection doesn't need to recompute them itself.
  const recurringLookbackStart = addMonths(monthStart, -RECURRING_LOOKBACK_MONTHS);
  const trendMonthStart = getMonthStart(now);
  const trendWindowStart = addMonths(trendMonthStart, -(MAX_FIXED_TREND_MONTHS - 1));
  const trendWindowEnd = getMonthEnd(trendMonthStart);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>{dict.budget.title}</PageTitle>
        {/* Phone pass (Oct 2026), P6: hidden on phones, where the title,
            month bar and tabs already filled ~40% of the first screen
            before any number showed. */}
        <p className="text-sm text-muted-foreground max-sm:hidden">{dict.budget.subtitle}</p>
        {/* UX-110: phones get one line saying what this budget is for. */}
        <p className="text-sm text-muted-foreground sm:hidden">
          {format(dict.budget.purpose, { household: viewedHouseholdName })}
        </p>
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

      <Suspense fallback={<BudgetTabsSkeleton label={dict.common.loading} />}>
        <BudgetTabsSection
          householdId={householdId}
          householdName={viewedHouseholdName}
          userId={userId}
          dict={dict}
          locale={locale}
          currencyCode={currencyCode}
          monthStart={monthStart}
          monthEnd={monthEnd}
          monthKey={monthKey}
          recurringLookbackStart={recurringLookbackStart}
          trendWindowStart={trendWindowStart}
          trendWindowEnd={trendWindowEnd}
          now={now}
          readOnly={readOnly}
          canChangeCurrency={!readOnly && role === "OWNER"}
          householdParam={householdParam}
        />
      </Suspense>
    </div>
  );
}
