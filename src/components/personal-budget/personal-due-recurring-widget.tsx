"use client";

// Mirrors DueRecurringWidget (src/components/budget/due-recurring-widget.tsx)
// for the personal budget — no members/split, uses PersonalTransactionDialog
// and the personal recurring-template actions.

import { useTransition } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acknowledgePersonalTemplatePeriodAction,
  logPersonalRecurringTemplateAction,
} from "@/app/dashboard/personal-budget/actions";
import {
  LogSharedExpenseDialog,
  type ShareableHousehold,
  type SharedExpensePrefill,
} from "@/components/personal-budget/log-shared-expense-dialog";
import { PersonalTransactionDialog } from "@/components/personal-budget/personal-transaction-dialog";
import type { PersonalRecurringTemplateListRow } from "@/components/personal-budget/personal-recurring-templates-panel";
import { format } from "@/lib/i18n/format";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

// A household RecurringTemplate the user has opted into a split for (see
// docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md) that's due but not yet posted this
// period — the "Rent pops up under my personal budget" case. Rendered
// inline with the user's own due templates, badged "Shared" and linking
// back to the household budget instead of offering log/acknowledge
// controls, since the household budget stays the one place these get
// logged or acknowledged.
export type SharedDueRow = {
  id: string;
  name: string;
  categoryName: string;
  /** This user's own share (RecurringTemplateSplit.amountOwed) — never the
   * template's full expected amount. */
  amount: number;
  householdName: string;
  /** What "Log payment" needs to log the whole bill (not just this user's
   * share) against the template — see SharedExpensePrefill. */
  logPrefill: SharedExpensePrefill;
};

export function PersonalDueRecurringWidget({
  templates,
  hasTemplates,
  sharedDueRows,
  sharedExpenseHouseholds,
  showHouseholdName,
  monthKey,
  categories,
  dict,
  locale,
  onManageClick,
}: {
  templates: PersonalRecurringTemplateListRow[];
  hasTemplates: boolean;
  sharedDueRows: SharedDueRow[];
  /** Households the user can log a shared expense into — a shared row only
   * gets a "Log payment" button when its household is in here. */
  sharedExpenseHouseholds: ShareableHousehold[];
  /** Only show which household a shared row belongs to once the user is in
   * more than one — see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6. */
  showHouseholdName: boolean;
  /** "YYYY-MM" — reused for the "View in {household} Budget" link's own
   * `?month=` param, since a due row is already scoped to this period. */
  monthKey: string;
  categories: CategoryRow[];
  dict: Dictionary["personalBudget"];
  locale: Locale;
  onManageClick: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
        {!hasTemplates && sharedDueRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.dueWidget.noTemplatesBody}</p>
        ) : templates.length === 0 && sharedDueRows.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-chart-5" />
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
                    <Badge variant="secondary" className="max-w-[10rem] truncate" title={template.categoryName}>
                      {template.categoryName}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {numberFormat.format(template.amount)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <PersonalTransactionDialog
                    dict={dict}
                    categories={categories}
                    monthKey={monthKey}
                    prefillFromTemplate={{
                      templateId: template.id,
                      categoryId: template.categoryId,
                      amount: template.amount,
                      description: template.name,
                      frequency: template.frequency,
                    }}
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
                        const result = await logPersonalRecurringTemplateAction(template.id);
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
                        const result = await acknowledgePersonalTemplatePeriodAction(template.id);
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
                      {dict.shared.sharedBadge}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {dict.shared.yourShare}: {numberFormat.format(row.amount)}
                    {showHouseholdName ? ` · ${row.householdName}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {sharedExpenseHouseholds.some((h) => h.id === row.logPrefill.householdId) && (
                    <LogSharedExpenseDialog
                      dict={dict}
                      households={sharedExpenseHouseholds}
                      monthKey={monthKey}
                      prefill={row.logPrefill}
                      trigger={
                        <Button size="xs" variant="secondary">
                          {dict.logShared.logPayment}
                        </Button>
                      }
                    />
                  )}
                  <Link
                    href={`/dashboard/budget?month=${monthKey}&household=${row.logPrefill.householdId}`}
                    className="shrink-0 text-sm font-medium text-primary hover:underline"
                  >
                    {format(dict.shared.viewInHouseholdBudget, { household: row.householdName })}
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
