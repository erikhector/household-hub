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
import { Check, CheckCircle2, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  /** What "Log payment" needs to log the whole bill (not just this user's
   * share) against the template — see SharedExpensePrefill. */
  logPrefill: SharedExpensePrefill;
};

export function DueRecurringWidget({
  templates,
  hasTemplates,
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
  const numberFormat = createMoneyFormat(locale, currencyCode);

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
        {!hasTemplates && sharedDueRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.dueWidget.noTemplatesBody}</p>
        ) : templates.length === 0 && sharedDueRows.length === 0 ? (
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
            {templates.map((template) => (
              <div
                key={template.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-medium" title={template.name}>
                      {template.name}
                    </span>
                    <Badge variant="secondary" className="max-w-[10rem]">
                      <span className="min-w-0 truncate" title={template.categoryName}>
                        {template.categoryName}
                      </span>
                    </Badge>
                    {template.splits.length > 0 && (
                      <Badge variant="secondary">{dict.recurring.split?.splitBadge}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {numberFormat.format(template.amount)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <TransactionDialog
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
                      <Button size="xs" variant="secondary">
                        {dict.recurring.logTransaction}
                      </Button>
                    }
                  />
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await onLogAsIs(template.id);
                        if (result.error) toast.error(result.error);
                        else toast.success(format(dict.recurring.loggedAsIsToast, { name: template.name }));
                      })
                    }
                  >
                    <Zap className="size-3.5" />
                    {dict.recurring.logAsIs}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await onAcknowledge(template.id);
                        if (result.error) toast.error(result.error);
                        else toast.success(format(dict.recurring.acknowledgedToast, { name: template.name }));
                      })
                    }
                  >
                    <Check className="size-3.5" />
                    {dict.recurring.markAccountedFor}
                  </Button>
                </div>
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
                    sharedExpenseHouseholds.some((h) => h.id === row.logPrefill.householdId) && (
                      <LogSharedExpenseDialog
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
                    href={`/dashboard/budget?month=${monthKey}&household=${row.logPrefill.householdId}`}
                    className="shrink-0 text-sm font-medium text-primary hover:underline"
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
