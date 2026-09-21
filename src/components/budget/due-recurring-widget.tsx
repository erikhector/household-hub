"use client";

// Always-visible "what needs my attention right now" strip, rendered by
// BudgetTabs above the tab bar so it's reachable without switching tabs or
// scrolling — unlike the full Recurring items panel (recurring-templates-panel.tsx),
// which lives inside the Plan tab and also handles add/edit/pause/delete.
// This widget only lists templates with status "due" and offers the same two
// quick actions the panel's "Due this period" section already has: log a
// transaction, or mark accounted for. Mirrored for the personal budget as
// PersonalDueRecurringWidget (src/components/personal-budget/personal-due-recurring-widget.tsx).

import { useTransition } from "react";
import { Check, CheckCircle2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acknowledgeTemplatePeriodAction,
  logRecurringTemplateAction,
} from "@/app/dashboard/budget/actions";
import { TransactionDialog, type MemberOption } from "@/components/budget/transaction-dialog";
import type { RecurringTemplateListRow } from "@/components/budget/recurring-templates-panel";
import { format } from "@/lib/i18n/format";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export function DueRecurringWidget({
  templates,
  hasTemplates,
  categories,
  members,
  currentMemberId,
  dict,
  locale,
  onManageClick,
}: {
  /** Already filtered to `status === "due"` — see page.tsx. */
  templates: RecurringTemplateListRow[];
  /** Whether the household has any active recurring template at all, due or
   * not — distinguishes "nothing set up yet" from "all caught up". */
  hasTemplates: boolean;
  categories: CategoryRow[];
  members: MemberOption[];
  currentMemberId: string;
  dict: Dictionary["budget"];
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
        {!hasTemplates ? (
          <p className="text-sm text-muted-foreground">{dict.dueWidget.noTemplatesBody}</p>
        ) : templates.length === 0 ? (
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
                    <Badge variant="secondary" className="max-w-[10rem]">
                      <span className="min-w-0 truncate" title={template.categoryName}>
                        {template.categoryName}
                      </span>
                    </Badge>
                    {template.splits.length > 0 && (
                      <Badge variant="secondary">{dict.recurring.split.splitBadge}</Badge>
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
                        const result = await logRecurringTemplateAction(template.id);
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
                        const result = await acknowledgeTemplatePeriodAction(template.id);
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
