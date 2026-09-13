"use client";

import { useTransition, type ReactNode } from "react";
import { Check, Pause, Pencil, Play, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  acknowledgePersonalTemplatePeriodAction,
  deletePersonalRecurringTemplateAction,
  setPersonalRecurringTemplateActiveAction,
  unacknowledgePersonalTemplatePeriodAction,
} from "@/app/dashboard/personal-budget/actions";
import {
  PersonalRecurringTemplateDialog,
  type PersonalRecurringTemplateRow,
} from "@/components/personal-budget/personal-recurring-template-dialog";
import { PersonalTransactionDialog } from "@/components/personal-budget/personal-transaction-dialog";
import { format } from "@/lib/i18n/format";
import type { PersonalCategoryRow } from "@/components/personal-budget/personal-category-manager";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type PersonalRecurringTemplateListRow = PersonalRecurringTemplateRow & {
  categoryName: string;
  status: "due" | "acknowledged" | "posted";
};

export type PausedPersonalRecurringTemplateRow = PersonalRecurringTemplateRow & {
  categoryName: string;
};

const frequencyLabelKey = {
  WEEKLY: "frequencyWeekly",
  MONTHLY: "frequencyMonthly",
  YEARLY: "frequencyYearly",
} as const satisfies Record<
  PersonalRecurringTemplateRow["frequency"],
  keyof Dictionary["personalBudget"]
>;

export function PersonalRecurringTemplatesPanel({
  templates,
  pausedTemplates,
  categories,
  dict,
  locale,
}: {
  templates: PersonalRecurringTemplateListRow[];
  pausedTemplates: PausedPersonalRecurringTemplateRow[];
  categories: PersonalCategoryRow[];
  dict: Dictionary["personalBudget"];
  locale: Locale;
}) {
  const [isPending, startTransition] = useTransition();
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const due = templates.filter((t) => t.status === "due");
  const acknowledged = templates.filter((t) => t.status === "acknowledged");
  const posted = templates.filter((t) => t.status === "posted");

  function handleTogglePause(id: string, active: boolean) {
    startTransition(async () => {
      const result = await setPersonalRecurringTemplateActiveAction(id, active);
      if (result.error) toast.error(result.error);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePersonalRecurringTemplateAction(id);
      if (result.error) toast.error(result.error);
    });
  }

  const isEmpty = templates.length === 0 && pausedTemplates.length === 0;

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-base font-semibold">{dict.recurring.title}</h2>
          <p className="text-sm text-muted-foreground">{dict.recurring.subtitle}</p>
        </div>
        <PersonalRecurringTemplateDialog
          dict={dict}
          categories={categories}
          trigger={
            <Button variant="outline" size="sm" disabled={categories.length === 0}>
              {dict.recurring.addTemplate}
            </Button>
          }
        />
      </div>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground">{dict.recurring.empty}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">{dict.recurring.statusLegend}</p>
          <TemplateGroup label={dict.recurring.sectionDue} items={due}>
            {(template) => (
              <TemplateRow
                key={template.id}
                template={template}
                dict={dict}
                numberFormat={numberFormat}
                isPending={isPending}
                onDelete={handleDelete}
                onTogglePause={handleTogglePause}
                categories={categories}
                actions={
                  <>
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
                          const result = await acknowledgePersonalTemplatePeriodAction(
                            template.id,
                          );
                          if (result.error) toast.error(result.error);
                          else toast.success(format(dict.recurring.acknowledgedToast, { name: template.name }));
                        })
                      }
                    >
                      <Check className="size-3.5" />
                      {dict.recurring.markAccountedFor}
                    </Button>
                  </>
                }
              />
            )}
          </TemplateGroup>

          <TemplateGroup label={dict.recurring.sectionAcknowledged} items={acknowledged}>
            {(template) => (
              <TemplateRow
                key={template.id}
                template={template}
                dict={dict}
                numberFormat={numberFormat}
                isPending={isPending}
                onDelete={handleDelete}
                onTogglePause={handleTogglePause}
                categories={categories}
                actions={
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await unacknowledgePersonalTemplatePeriodAction(
                          template.id,
                        );
                        if (result.error) toast.error(result.error);
                        else toast.success(format(dict.recurring.undoToast, { name: template.name }));
                      })
                    }
                  >
                    <Undo2 className="size-3.5" />
                    {dict.recurring.undo}
                  </Button>
                }
              />
            )}
          </TemplateGroup>

          <TemplateGroup label={dict.recurring.sectionPosted} items={posted}>
            {(template) => (
              <TemplateRow
                key={template.id}
                template={template}
                dict={dict}
                numberFormat={numberFormat}
                isPending={isPending}
                onDelete={handleDelete}
                onTogglePause={handleTogglePause}
                categories={categories}
              />
            )}
          </TemplateGroup>

          {pausedTemplates.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {dict.recurring.pausedBadge}
              </p>
              <div className="flex flex-col gap-2">
                {pausedTemplates.map((template) => (
                  <TemplateRow
                    key={template.id}
                    template={{ ...template, status: "due" }}
                    dict={dict}
                    numberFormat={numberFormat}
                    isPending={isPending}
                    onDelete={handleDelete}
                    onTogglePause={handleTogglePause}
                    categories={categories}
                    paused
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TemplateGroup({
  label,
  items,
  children,
}: {
  label: string;
  items: PersonalRecurringTemplateListRow[];
  children: (template: PersonalRecurringTemplateListRow) => ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-2">{items.map((template) => children(template))}</div>
    </div>
  );
}

function TemplateRow({
  template,
  dict,
  numberFormat,
  isPending,
  onDelete,
  onTogglePause,
  categories,
  actions,
  paused = false,
}: {
  template: PersonalRecurringTemplateListRow;
  dict: Dictionary["personalBudget"];
  numberFormat: Intl.NumberFormat;
  isPending: boolean;
  onDelete: (id: string) => void;
  onTogglePause: (id: string, active: boolean) => void;
  categories: PersonalCategoryRow[];
  actions?: ReactNode;
  paused?: boolean;
}) {
  const frequencyLabel = dict[frequencyLabelKey[template.frequency]];

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium" title={template.name}>
            {template.name}
          </span>
          <Badge variant="secondary" className="max-w-[10rem] truncate" title={template.categoryName}>
            {template.categoryName}
          </Badge>
          {paused && <Badge variant="outline">{dict.recurring.pausedBadge}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {numberFormat.format(template.amount)} · {frequencyLabel}
          {template.dayOfMonth
            ? ` · ${format(dict.recurring.dueDayLabel, { day: template.dayOfMonth })}`
            : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {actions}
        <PersonalRecurringTemplateDialog
          dict={dict}
          categories={categories}
          template={template}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label={format(dict.recurring.editAriaLabel, { name: template.name })}
            >
              <Pencil className="size-3.5" />
            </Button>
          }
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          disabled={isPending}
          aria-label={paused ? dict.recurring.resume : dict.recurring.pause}
          onClick={() => onTogglePause(template.id, paused)}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          disabled={isPending}
          aria-label={format(dict.recurring.deleteAriaLabel, { name: template.name })}
          onClick={() => onDelete(template.id)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
