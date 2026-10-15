"use client";

// "What needs my attention right now" strip, rendered by BudgetTabs (both
// budget pages) at the top of the Overview landing tab so it's reachable
// without switching tabs or scrolling — unlike the full Recurring items panel
// (recurring-templates-panel.tsx), which lives inside the Manage tab and
// also handles add/edit/pause/delete. This widget only lists templates with
// status "due" and offers the same two quick actions the panel's "Due this
// period" section already has: log a transaction, or mark accounted for.
// Merged from the formerly-separate PersonalDueRecurringWidget (BUDGET-2) —
// the sharedDueRows/sharedExpenseHouseholds/showHouseholdName props below
// are only ever non-empty on the personal budget page, see their doc
// comments.

import { useTransition } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Ellipsis, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TransactionDialog,
  type MemberOption,
  type TransactionFormAction,
} from "@/components/budget/transaction-dialog";
import {
  LogSharedExpenseDialog,
  type ShareableHousehold,
  type SharedExpensePrefill,
} from "@/components/personal-budget/log-shared-expense-dialog";
import {
  PlannedBillAmountLine,
  PlannedBillLogPayment,
  type PlannedExpenseRow,
} from "@/components/budget/planned-expenses-panel";
import type { RecurringTemplateListRow } from "@/components/budget/recurring-templates-panel";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";

// A household RecurringTemplate the user has opted into a split for (see
// docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md) that's due but not yet
// posted this period — the "Rent pops up under my personal budget" case.
// Rendered inline with the user's own due templates, badged "Shared" and
// linking back to the household budget instead of offering log/acknowledge
// controls, since the household budget stays the one place these get logged
// or acknowledged. Only ever non-empty on the personal budget page.
export type SharedDueRow = {
  id: string;
  name: string;
  categoryName: string;
  /** The template's own type — a shared *saving* counts towards "due
   * savings" in the personal budget's headline, not "due payments". */
  type: "INCOME" | "EXPENSE" | "SAVINGS";
  /** This user's own share (RecurringTemplateSplit.amountOwed) — never the
   * template's full expected amount. */
  amount: number;
  householdName: string;
  /** For the "View in {household} Budget" link, which every shared row has. */
  householdId: string;
  /** What "Log payment" needs to log the whole bill (not just this user's
   * share) against the template — see SharedExpensePrefill. Absent on a
   * planned bill's share (BUDGET-8), which is paid from the household's
   * Budget page, so no "Log payment" shows. */
  logPrefill?: SharedExpensePrefill;
};

export function DueRecurringWidget({
  templates,
  hasTemplates,
  plannedDue = [],
  sharedDueRows = [],
  sharedExpenseHouseholds = [],
  showHouseholdName = false,
  categories,
  members = [],
  currentMemberId = "",
  monthKey,
  dict,
  logSharedDialogDict,
  locale,
  currencyCode,
  onManageClick,
  onAcknowledge,
  onLogAsIs,
  createTransactionAction,
  updateTransactionAction,
}: {
  /** Already filtered to `status === "due"` — see page.tsx. */
  templates: RecurringTemplateListRow[];
  /** Whether the household (or user) has any active recurring template at
   * all, due or not — distinguishes "nothing set up yet" from "all caught
   * up". */
  hasTemplates: boolean;
  /** Outstanding (overdue or due) planned bills, BUDGET-8 — already filtered
   * with isPlannedExpenseOutstanding. Listed after the templates; any entry
   * counts as content, so the "nothing set up" state doesn't show. Always
   * `[]` on the personal budget page. */
  plannedDue?: PlannedExpenseRow[];
  /** The user's own share of due-but-not-yet-posted shared household
   * RecurringTemplates (see SharedDueRow's doc comment) — merged straight
   * into the due list below, badged "Shared". Always `[]` on the household
   * budget page. */
  sharedDueRows?: SharedDueRow[];
  /** Households the user can log a shared expense into (more than one
   * member each) — a sharedDueRows entry only gets a "Log payment" button
   * when its household is in here. Always `[]` on the household budget
   * page. See LogSharedExpenseDialog. */
  sharedExpenseHouseholds?: ShareableHousehold[];
  /** Only show which household a shared row belongs to once the user is in
   * more than one — see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6.
   * Meaningless (and always `false`) whenever sharedDueRows is empty. */
  showHouseholdName?: boolean;
  categories: CategoryRow[];
  /** Every member of the active household — see TransactionDialog's
   * identical prop. Always `[]` on the personal budget page (BUDGET-2). */
  members?: MemberOption[];
  currentMemberId?: string;
  /** "YYYY-MM" of the month currently being browsed — threaded to
   * TransactionDialog's "Log transaction" trigger (F11) and, on the personal
   * budget page, to a shared row's "View in {household} Budget" link. */
  monthKey: string;
  dict: BudgetDict;
  /** The full personal-budget dictionary, needed only to satisfy
   * LogSharedExpenseDialog's own (wider) dict type — see that component's
   * doc comment. Only ever read when sharedExpenseHouseholds is non-empty,
   * which never happens on the household budget page, so it's left
   * undefined there. */
  logSharedDialogDict?: Dictionary["personalBudget"];
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
  onManageClick: () => void;
  /** acknowledgeTemplatePeriodAction (household) or
   * acknowledgePersonalTemplatePeriodAction (personal). */
  onAcknowledge: (id: string) => Promise<ActionState>;
  /** logRecurringTemplateAction (household) or
   * logPersonalRecurringTemplateAction (personal). */
  onLogAsIs: (id: string) => Promise<ActionState>;
  createTransactionAction: TransactionFormAction;
  updateTransactionAction: TransactionFormAction;
}) {
  const [isPending, startTransition] = useTransition();
  const planned = dict.planned;
  const numberFormat = createMoneyFormat(locale, currencyCode);
  // Due dates are UTC-noon calendar days, so they're shown in UTC (as in
  // PlannedExpensesPanel).
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <Card>
      <CardHeader className="flex flex-col items-start gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{dict.dueWidget.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{dict.dueWidget.subtitle}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onManageClick}>
          {dict.dueWidget.manageButton}
        </Button>
      </CardHeader>
      <CardContent>
        {!hasTemplates && sharedDueRows.length === 0 && plannedDue.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.dueWidget.noTemplatesBody}</p>
        ) : templates.length === 0 && sharedDueRows.length === 0 && plannedDue.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" />
            <span>
              <span className="font-medium text-foreground">{dict.dueWidget.allCaughtUpTitle}</span>
              {" — "}
              {dict.dueWidget.allCaughtUpBody}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Phone pass (Oct 2026), P4: one line per item — name, then
                amount and category in caption size, with one "Log" and a
                "More" menu for the two rarer actions. Three buttons in a
                row used to wrap each item to ~370 px on a phone. */}
            {templates.map((template) => (
              <div key={template.id} className="flex items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium" title={template.name}>
                    {template.name}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="shrink-0 tabular-nums">{numberFormat.format(template.amount)}</span>
                    <span aria-hidden>·</span>
                    <span className="min-w-0 truncate" title={template.categoryName}>
                      {template.categoryName}
                    </span>
                    {template.splits.length > 0 && (
                      <Badge variant="secondary">{dict.recurring.split?.splitBadge}</Badge>
                    )}
                  </span>
                </div>
                <TransactionDialog
                  numberFormat={numberFormat}
                  dict={dict}
                  categories={categories}
                  members={members}
                  currentMemberId={currentMemberId}
                  monthKey={monthKey}
                  prefillFromTemplate={{
                    templateId: template.id,
                    categoryId: template.categoryId,
                    amount: template.amount,
                    description: template.name,
                    frequency: template.frequency,
                    splits: template.splits,
                  }}
                  createAction={createTransactionAction}
                  updateAction={updateTransactionAction}
                  trigger={
                    <Button size="sm" variant="secondary">
                      {dict.dueWidget.log}
                    </Button>
                  }
                />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isPending}
                        aria-label={format(dict.dueWidget.moreAriaLabel, { name: template.name })}
                      >
                        <Ellipsis className="size-4" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-auto">
                    <DropdownMenuItem
                      onClick={() =>
                        startTransition(async () => {
                          const result = await onLogAsIs(template.id);
                          if (result.error) toast.error(result.error);
                          else toast.success(format(dict.recurring.loggedAsIsToast, { name: template.name }));
                        })
                      }
                    >
                      <Zap />
                      {dict.recurring.logAsIs}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        startTransition(async () => {
                          const result = await onAcknowledge(template.id);
                          if (result.error) toast.error(result.error);
                          else toast.success(format(dict.recurring.acknowledgedToast, { name: template.name }));
                        })
                      }
                    >
                      <Check />
                      {dict.recurring.markAccountedFor}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            {/* Same one-line shape as the recurring items above: name and
                category, then amount and due date in caption size, with the
                one action at the end. */}
            {planned && plannedDue.map((bill) => (
              <div key={bill.id} className="flex items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="min-w-0 truncate font-medium" title={bill.name}>
                      {bill.name}
                    </span>
                    <span className="min-w-0 shrink-[2] truncate text-xs text-muted-foreground" title={bill.categoryName}>
                      {bill.categoryName}
                    </span>
                  </span>
                  <PlannedBillAmountLine
                    bill={bill}
                    numberFormat={numberFormat}
                    dateFormat={dateFormat}
                    t={planned}
                  />
                </div>
                {/* Already paid after this (past) month: nothing left to log. */}
                {bill.paidAt === null && (
                  <div className="shrink-0">
                    <PlannedBillLogPayment
                      bill={bill}
                      dict={dict}
                      t={planned}
                      numberFormat={numberFormat}
                      categories={categories}
                      members={members}
                      currentMemberId={currentMemberId}
                      monthKey={monthKey}
                      createTransactionAction={createTransactionAction}
                      updateTransactionAction={updateTransactionAction}
                    />
                  </div>
                )}
              </div>
            ))}
            {sharedDueRows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-medium" title={row.name}>
                      {row.name}
                    </span>
                    <Badge variant="secondary" className="max-w-[10rem] truncate" title={row.categoryName}>
                      {row.categoryName}
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      <Users className="size-3" />
                      {dict.shared?.sharedBadge}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {dict.shared?.yourShare}: {numberFormat.format(row.amount)}
                    {showHouseholdName ? ` · ${row.householdName}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {logSharedDialogDict &&
                    row.logPrefill &&
                    sharedExpenseHouseholds.some((h) => h.id === row.logPrefill!.householdId) && (
                      <LogSharedExpenseDialog
                        numberFormat={numberFormat}
                        dict={logSharedDialogDict}
                        households={sharedExpenseHouseholds}
                        monthKey={monthKey}
                        prefill={row.logPrefill}
                        trigger={
                          <Button size="xs" variant="secondary">
                            {dict.logShared?.logPayment}
                          </Button>
                        }
                      />
                    )}
                  <Link
                    href={`/dashboard/budget?month=${monthKey}&household=${row.householdId}`}
                    className="touch-target shrink-0 text-sm font-medium text-primary hover:underline"
                  >
                    {format(dict.shared?.viewInHouseholdBudget ?? "", { household: row.householdName })}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
