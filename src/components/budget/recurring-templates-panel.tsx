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
import type {
  RecurringTemplateFormAction,
  RecurringTemplateRow,
} from "@/components/budget/recurring-template-dialog";
import type { MemberOption } from "@/components/budget/transaction-dialog";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";
import { LazyRecurringTemplateDialog } from "@/components/budget/lazy-budget-dialogs";

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

// The recurring half of the Setup tab's Bills & income card
// (bills-and-income-panel.tsx), which owns the heading and the one Add
// button. Budget redesign (Oct 2026): one flat list, most urgent first, with
// each row's status as a chip, instead of a panel of its own with a status
// legend and a sub-heading per status ("Due this period", "Accounted for",
// "Logged", "Paused"). Logging a due item happens on the Overview's Needs
// attention card, which lists every due row with its Log button; repeating
// that button here put the same item and action on two tabs.
export function RecurringTemplateList({
  templates,
  pausedTemplates,
  categories,
  members = [],
  dict,
  locale,
  currencyCode,
  onTogglePause,
  onDelete,
  onAcknowledge,
  onUnacknowledge,
  createTemplateAction,
  updateTemplateAction,
}: {
  templates: RecurringTemplateListRow[];
  pausedTemplates: PausedRecurringTemplateRow[];
  categories: CategoryRow[];
  /** Every member of the active household — see TransactionDialog's
   * identical prop (src/components/budget/transaction-dialog.tsx). The
   * personal budget page (BUDGET-2) omits this entirely. */
  members?: MemberOption[];
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
}) {
  const [isPending, startTransition] = useTransition();
  const numberFormat = createMoneyFormat(locale, currencyCode);

  // Due first (it wants doing), then accounted for (it can be undone), then
  // logged; paused last.
  const ordered = [
    ...templates.filter((t) => t.status === "due"),
    ...templates.filter((t) => t.status === "acknowledged"),
    ...templates.filter((t) => t.status === "posted"),
  ];

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

  const rowProps = {
    dict,
    numberFormat,
    isPending,
    onDelete: handleDelete,
    onTogglePause: handleTogglePause,
    categories,
    members,
    createTemplateAction,
    updateTemplateAction,
  };

  return (
    <ul className="flex flex-col gap-2">
      {ordered.map((template) => (
        <li key={template.id}>
          <TemplateRow
            template={template}
            {...rowProps}
            onMarkAccountedFor={
              template.status === "due"
                ? () =>
                    startTransition(async () => {
                      const result = await onAcknowledge(template.id);
                      if (result.error) toast.error(result.error);
                      else toast.success(format(dict.recurring.acknowledgedToast, { name: template.name }));
                    })
                : undefined
            }
            primary={
              template.status === "acknowledged" ? (
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
              ) : undefined
            }
          />
        </li>
      ))}
      {pausedTemplates.map((template) => (
        <li key={template.id}>
          <TemplateRow template={{ ...template, status: "due" }} {...rowProps} paused />
        </li>
      ))}
    </ul>
  );
}

// Status as a chip on the row (tinted text, never colour alone: the chip is
// a word). Due wants doing, so it's amber; logged is done, so green.
const STATUS_BADGE = {
  due: { variant: "warning", label: "sectionDue" },
  acknowledged: { variant: "secondary", label: "sectionAcknowledged" },
  posted: { variant: "outline", label: "sectionPosted" },
} as const satisfies Record<
  RecurringTemplateListRow["status"],
  { variant: "warning" | "secondary" | "outline"; label: keyof BudgetDict["recurring"] }
>;

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
  /** The row's one visible action: "Undo" once accounted for. A paused
   * row's is Resume; a due or posted row has none here (due rows are logged
   * from the Overview's Needs attention card). */
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
          {paused ? (
            <Badge variant="outline">{dict.recurring.pausedBadge}</Badge>
          ) : (
            <Badge
              variant={STATUS_BADGE[template.status].variant}
              className={template.status === "posted" ? "border-success/30 text-success" : undefined}
            >
              {dict.recurring[STATUS_BADGE[template.status].label]}
            </Badge>
          )}
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
      <LazyRecurringTemplateDialog
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
