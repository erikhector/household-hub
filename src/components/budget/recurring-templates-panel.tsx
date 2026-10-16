"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Ellipsis, Pause, Pencil, Play, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createDialogHandle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RecurringTemplateDialog,
  type RecurringTemplateFormAction,
  type RecurringTemplateRow,
} from "@/components/budget/recurring-template-dialog";
import {
  TransactionDialog,
  type MemberOption,
  type TransactionFormAction,
} from "@/components/budget/transaction-dialog";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";

export type RecurringTemplateListRow = RecurringTemplateRow & {
  categoryName: string;
  status: "due" | "acknowledged" | "posted";
  /** Display name of whoever ran "Mark accounted for" for the current
   * period (F7 — attribution for a household-wide action), resolved from
   * RecurringTemplateAck.createdByUserId. Only meaningful when
   * `status === "acknowledged"`; null when the ack predates this field (no
   * backfill) or its acknowledger has since left the household. Always
   * omitted for the personal budget page (BUDGET-2) — there's no
   * multi-user attribution to show for a single-user budget, which is what
   * `dict.recurring.acknowledgedByLabel`'s own presence already gates below. */
  acknowledgedByName?: string | null;
};

export type PausedRecurringTemplateRow = RecurringTemplateRow & { categoryName: string };

const frequencyLabelKey = {
  WEEKLY: "frequencyWeekly",
  MONTHLY: "frequencyMonthly",
  YEARLY: "frequencyYearly",
} as const satisfies Record<RecurringTemplateRow["frequency"], keyof BudgetDict>;

export function RecurringTemplatesPanel({
  templates,
  pausedTemplates,
  categories,
  members = [],
  currentMemberId = "",
  monthKey,
  dict,
  locale,
  currencyCode,
  onTogglePause,
  onDelete,
  onAcknowledge,
  onUnacknowledge,
  createTemplateAction,
  updateTemplateAction,
  createTransactionAction,
  updateTransactionAction,
}: {
  templates: RecurringTemplateListRow[];
  pausedTemplates: PausedRecurringTemplateRow[];
  categories: CategoryRow[];
  /** Every member of the active household — see TransactionDialog's
   * identical prop (src/components/budget/transaction-dialog.tsx). The
   * personal budget page (BUDGET-2) omits this entirely. */
  members?: MemberOption[];
  currentMemberId?: string;
  /** "YYYY-MM" of the month currently being browsed — threaded to the "Log
   * transaction" dialog below so a new transaction defaults to a date within
   * it (F11) instead of always today. */
  monthKey: string;
  dict: BudgetDict;
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
  /** setRecurringTemplateActiveAction (household) or
   * setPersonalRecurringTemplateActiveAction (personal). */
  onTogglePause: (id: string, active: boolean) => Promise<ActionState>;
  /** deleteRecurringTemplateAction (household) or
   * deletePersonalRecurringTemplateAction (personal). */
  onDelete: (id: string) => Promise<ActionState>;
  /** acknowledgeTemplatePeriodAction (household) or
   * acknowledgePersonalTemplatePeriodAction (personal). */
  onAcknowledge: (id: string) => Promise<ActionState>;
  /** unacknowledgeTemplatePeriodAction (household) or
   * unacknowledgePersonalTemplatePeriodAction (personal). */
  onUnacknowledge: (id: string) => Promise<ActionState>;
  createTemplateAction: RecurringTemplateFormAction;
  updateTemplateAction: RecurringTemplateFormAction;
  createTransactionAction: TransactionFormAction;
  updateTransactionAction: TransactionFormAction;
}) {
  const [isPending, startTransition] = useTransition();
  const numberFormat = createMoneyFormat(locale, currencyCode);

  const due = templates.filter((t) => t.status === "due");
  const acknowledged = templates.filter((t) => t.status === "acknowledged");
  const posted = templates.filter((t) => t.status === "posted");

  function handleTogglePause(id: string, active: boolean) {
    startTransition(async () => {
      const result = await onTogglePause(id, active);
      if (result.error) toast.error(result.error);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await onDelete(id);
      if (result.error) toast.error(result.error);
    });
  }

  const isEmpty = templates.length === 0 && pausedTemplates.length === 0;

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-base font-semibold">{dict.recurring.title}</h2>
          <p className="text-sm text-muted-foreground">{dict.recurring.subtitle}</p>
        </div>
        <RecurringTemplateDialog
          numberFormat={numberFormat}
          dict={dict}
          categories={categories}
          members={members}
          createAction={createTemplateAction}
          updateAction={updateTemplateAction}
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
                members={members}
                createTemplateAction={createTemplateAction}
                updateTemplateAction={updateTemplateAction}
                onMarkAccountedFor={() =>
                  startTransition(async () => {
                    const result = await onAcknowledge(template.id);
                    if (result.error) toast.error(result.error);
                    else toast.success(format(dict.recurring.acknowledgedToast, { name: template.name }));
                  })
                }
                primary={
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
                members={members}
                createTemplateAction={createTemplateAction}
                updateTemplateAction={updateTemplateAction}
                primary={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await onUnacknowledge(template.id);
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
                members={members}
                createTemplateAction={createTemplateAction}
                updateTemplateAction={updateTemplateAction}
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
                    members={members}
                    createTemplateAction={createTemplateAction}
                    updateTemplateAction={updateTemplateAction}
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
  items: RecurringTemplateListRow[];
  children: (template: RecurringTemplateListRow) => ReactNode;
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
  members,
  createTemplateAction,
  updateTemplateAction,
  primary,
  onMarkAccountedFor,
  paused = false,
}: {
  template: RecurringTemplateListRow;
  dict: BudgetDict;
  numberFormat: Intl.NumberFormat;
  isPending: boolean;
  onDelete: (id: string) => void;
  onTogglePause: (id: string, active: boolean) => void;
  categories: CategoryRow[];
  members: MemberOption[];
  createTemplateAction: RecurringTemplateFormAction;
  updateTemplateAction: RecurringTemplateFormAction;
  /** The row's one visible action: "Log" when due, "Undo" once accounted
   * for. A paused row's is Resume; a posted row has none. */
  primary?: ReactNode;
  /** Due rows only: "Mark as accounted for", in the menu. */
  onMarkAccountedFor?: () => void;
  paused?: boolean;
}) {
  const frequencyLabel = dict[frequencyLabelKey[template.frequency]];
  // Phone pass (Oct 2026), P5: one visible action plus a "More" menu, on
  // one line. Five buttons (log, mark, edit, pause, delete) used to wrap,
  // stranding pause and delete on a second line under the pencil, with
  // delete right beside the others (DESIGN.md M2). Edit and Delete open
  // their dialogs from the menu: Edit through a hidden trigger (ItemActions'
  // pattern), Delete through a dialog handle, since a dialog rendered
  // inside the menu would unmount as the menu closes.
  const editRef = useRef<HTMLButtonElement | null>(null);
  const [deleteHandle] = useState(() => createDialogHandle());
  const resume = paused ? (
    <Button size="sm" variant="outline" disabled={isPending} onClick={() => onTogglePause(template.id, true)}>
      <Play className="size-3.5" />
      {dict.recurring.resume}
    </Button>
  ) : null;

  return (
    <div className="flex items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 max-w-full break-words font-medium" title={template.name}>
            {template.name}
          </span>
          {template.splits.length > 0 && (
            <Badge variant="secondary" className="gap-1">
              {dict.recurring.split?.splitBadge}
            </Badge>
          )}
          {paused && <Badge variant="outline">{dict.recurring.pausedBadge}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {numberFormat.format(template.amount)} · {frequencyLabel}
          {template.dayOfMonth
            ? ` · ${format(dict.recurring.dueDayLabel, { day: template.dayOfMonth })}`
            : ""}
          {" · "}
          {template.categoryName}
        </p>
        {/* Household-only: personalBudget's dict omits acknowledgedByLabel/
            acknowledgedByUnknown entirely (no multi-user attribution concept
            for a single-user budget) — its presence doubles as the
            household/personal switch here, see RecurringTemplateListRow's
            acknowledgedByName doc comment. */}
        {template.status === "acknowledged" && dict.recurring.acknowledgedByLabel && (
          <p className="text-xs text-muted-foreground">
            {template.acknowledgedByName
              ? format(dict.recurring.acknowledgedByLabel, { name: template.acknowledgedByName })
              : dict.recurring.acknowledgedByUnknown}
          </p>
        )}
      </div>
      {primary ?? resume}
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
          {onMarkAccountedFor && (
            <DropdownMenuItem onClick={onMarkAccountedFor}>
              <Check />
              {dict.recurring.markAccountedFor}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => editRef.current?.click()}>
            <Pencil />
            {dict.swipe.edit}
          </DropdownMenuItem>
          {!paused && (
            <DropdownMenuItem onClick={() => onTogglePause(template.id, false)}>
              <Pause />
              {dict.recurring.pause}
            </DropdownMenuItem>
          )}
          {/* Last and set apart: the destructive one. */}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => deleteHandle.open(null)}>
            <Trash2 />
            {dict.swipe.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RecurringTemplateDialog
        numberFormat={numberFormat}
        dict={dict}
        categories={categories}
        members={members}
        template={template}
        createAction={createTemplateAction}
        updateAction={updateTemplateAction}
        trigger={
          // Opened from the menu's Edit; not a target of its own.
          <button
            ref={editRef}
            type="button"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
        }
      />
      <ConfirmDialog
        handle={deleteHandle}
        title={format(dict.recurring.confirmDelete.title, { name: template.name })}
        description={dict.recurring.confirmDelete.description}
        cancelLabel={dict.recurring.confirmDelete.cancel}
        confirmLabel={dict.recurring.confirmDelete.confirm}
        pendingLabel={dict.recurring.confirmDelete.confirming}
        onConfirm={() => onDelete(template.id)}
      />
    </div>
  );
}
