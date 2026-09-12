"use client";

// Mirrors DueRecurringWidget (src/components/budget/due-recurring-widget.tsx)
// for the personal budget — no members/split, uses PersonalTransactionDialog
// and the personal recurring-template actions.

import { useTransition } from "react";
import { Check, CheckCircle2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acknowledgePersonalTemplatePeriodAction,
  logPersonalRecurringTemplateAction,
} from "@/app/dashboard/personal-budget/actions";
import { PersonalTransactionDialog } from "@/components/personal-budget/personal-transaction-dialog";
import type { PersonalRecurringTemplateListRow } from "@/components/personal-budget/personal-recurring-templates-panel";
import { format } from "@/lib/i18n/format";
import type { PersonalCategoryRow } from "@/components/personal-budget/personal-category-manager";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export function PersonalDueRecurringWidget({
  templates,
  hasTemplates,
  categories,
  dict,
  locale,
  onManageClick,
}: {
  templates: PersonalRecurringTemplateListRow[];
  hasTemplates: boolean;
  categories: PersonalCategoryRow[];
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
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
