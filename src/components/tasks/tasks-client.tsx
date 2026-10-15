"use client";

// Household Tasks v1 (see docs/archive/JOY_GAP_BACKLOG.md item 6b) — one shared task list
// per household. Mirrors ShoppingListClient's shape: an add-task form, a
// flat list split into an open section and a completed section. Creating and
// editing a task both go through the shared TaskFormDialog (see
// task-form-dialog.tsx) rather than delete-and-re-add.

import { useOptimistic, useTransition } from "react";
import { Check, Trash2, Repeat, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteTaskAction, toggleTaskCompletedAction } from "@/app/dashboard/tasks/actions";
import { getNextDueDate } from "@/app/dashboard/tasks/recurrence";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { SwipeRow } from "@/components/shared/swipe-row";
import { useUndoableDelete } from "@/components/shared/use-undoable-delete";
import { TasksWeeklyRecap, type WeeklyRecapGroupView } from "@/components/tasks/tasks-weekly-recap";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

type MemberOption = { id: string; displayName: string };

type TaskRow = {
  id: string;
  title: string;
  assignedToMemberId: string | null;
  completedByMemberId: string | null;
  completed: boolean;
  recurrenceIntervalDays: number | null;
  completedAt: Date | null;
  rotationMemberIds: string[];
  /** GAP-38: who's up after the current turn; null unless the task rotates. */
  nextInRotationMemberId: string | null;
};

type TasksDict = Dictionary["tasks"];

export function TasksClient({
  dict,
  members,
  tasks,
  recapGroups,
  locale,
}: {
  dict: TasksDict;
  members: MemberOption[];
  tasks: TaskRow[];
  recapGroups: WeeklyRecapGroupView[];
  locale: Locale;
}) {
  const memberNameById = new Map(members.map((m) => [m.id, m.displayName]));

  const openTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed);

  return (
    <div className="flex flex-col gap-6">
      {recapGroups.length > 0 && <TasksWeeklyRecap groups={recapGroups} dict={dict} />}

      <div className="flex flex-col gap-2">
        {tasks.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {dict.emptyState}
          </p>
        ) : (
          <>
            {openTasks.map((task) => (
              <TaskItemRow
                key={task.id}
                task={task}
                members={members}
                memberNameById={memberNameById}
                dict={dict}
                locale={locale}
              />
            ))}
            {completedTasks.length > 0 && (
              <p className="mt-4 text-xs font-medium uppercase text-muted-foreground">
                {dict.completedSectionLabel}
              </p>
            )}
            {completedTasks.map((task) => (
              <TaskItemRow
                key={task.id}
                task={task}
                members={members}
                memberNameById={memberNameById}
                dict={dict}
                locale={locale}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function TaskItemRow({
  task,
  members,
  memberNameById,
  dict,
  locale,
}: {
  task: TaskRow;
  members: MemberOption[];
  memberNameById: Map<string, string>;
  dict: TasksDict;
  locale: Locale;
}) {
  // UX-14: the tick shows at once, in this row's own transition, so ticking
  // off several chores in a row never waits on (or greys out behind) an
  // earlier save. The row stays where it is until the server answers and
  // only then moves to "Completed" (no list jumping under your thumb), and a
  // failed save rolls the tick back with a toast. Same pattern as the
  // shopping list's ShoppingRow.
  const [, startToggleTransition] = useTransition();
  const [completed, toggleOptimisticCompleted] = useOptimistic<boolean, void>(task.completed, (current) => !current);
  const handleToggleCompleted = () => {
    startToggleTransition(async () => {
      toggleOptimisticCompleted();
      await settleOptimisticAction(() => toggleTaskCompletedAction(task.id), dict.saveFailedToast);
    });
  };
  // UX-35: swipe left → Delete hides the row with an Undo toast.
  const { hidden, remove } = useUndoableDelete({
    run: async () => (await settleOptimisticAction(() => deleteTaskAction(task.id), dict.saveFailedToast)) !== null,
    message: format(dict.swipe.deletedToast, { name: task.title }),
    undoLabel: dict.swipe.undo,
  });

  const assigneeName = task.assignedToMemberId ? memberNameById.get(task.assignedToMemberId) : undefined;
  const completerName = task.completedByMemberId ? memberNameById.get(task.completedByMemberId) : undefined;
  const nextInRotationName = task.nextInRotationMemberId
    ? memberNameById.get(task.nextInRotationMemberId)
    : undefined;
  const recurrenceLabel = task.recurrenceIntervalDays
    ? format(plural(task.recurrenceIntervalDays, dict.recurrenceBadge), { count: task.recurrenceIntervalDays })
    : null;
  // Only meaningful while the task is still shown completed — a recurring
  // task's `completedAt` also sticks around once it's auto-reopened past its
  // interval (see recurrence.ts), at which point "next due" would be a date
  // in the past, which isn't worth surfacing.
  const nextDueAt = task.completed ? getNextDueDate(task) : null;
  const nextDueLabel = nextDueAt
    ? format(dict.nextDueLabel, {
        date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(nextDueAt),
      })
    : null;

  if (hidden) return null;

  return (
    <SwipeRow
      className="rounded-md"
      primaryLabel={completed ? dict.swipe.reopen : dict.swipe.complete}
      primaryIcon={<Check className="size-4" />}
      editLabel={dict.swipe.edit}
      deleteLabel={dict.swipe.delete}
      onDelete={remove}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
        {/* basis-full forces the title onto its own line on narrow screens —
            otherwise the recurrence/assignee badges and the edit/delete
            buttons (all shrink-0) crowd the flex-1 title span down to just a
            few visible characters. */}
        <label className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
          <Checkbox
            data-swipe-primary
            checked={completed}
            aria-label={format(completed ? dict.toggleIncompleteAriaLabel : dict.toggleCompleteAriaLabel, {
              title: task.title,
            })}
            onChange={handleToggleCompleted}
          />
          <span
            className={`min-w-0 flex-1 line-clamp-2 break-words sm:line-clamp-1 ${completed ? "text-muted-foreground line-through" : ""}`}
            title={task.title}
          >
            {task.title}
          </span>
        </label>
        {/* w-full below sm gives this group its own full-width row to wrap
            badges/buttons within — shrink-0 alone left it sized to its
            unwrapped content width, which could overflow the card on narrow
            screens instead of actually wrapping. */}
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0">
          {recurrenceLabel && (
            <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
              <Repeat className="size-3" />
              {recurrenceLabel}
            </Badge>
          )}
          {nextDueLabel && <span className="shrink-0 text-xs text-muted-foreground">{nextDueLabel}</span>}
          {/* Just whose turn is next — never a count or tally of who's done
              it how often (see REQUIREMENTS.md, "Household tasks"). */}
          {nextInRotationName && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {format(dict.rotationNextLabel, { name: nextInRotationName })}
            </span>
          )}
          {!task.completed && (
            <Badge variant={assigneeName ? "secondary" : "outline"} className="shrink-0">
              {assigneeName ?? dict.unassignedBadge}
            </Badge>
          )}
          {task.completed && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {format(dict.completedByLabel, { name: completerName ?? dict.unassignedBadge })}
            </span>
          )}
          {/* An open task can still carry a completedByMemberId from before it
              was reopened (manually, or automatically once its recurrence
              interval elapsed — see toggleTaskCompletedAction/recurrence.ts):
              that's real "last done by" history, not stale data, so surface it
              rather than letting it silently disappear once the task reopens. */}
          {!task.completed && completerName && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {format(dict.lastCompletedByLabel, { name: completerName })}
            </span>
          )}
          <TaskFormDialog
            mode="edit"
            task={task}
            members={members}
            dict={dict}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                data-swipe-edit
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={format(dict.editTaskAriaLabel, { title: task.title })}
              >
                <Pencil className="size-3.5" />
              </Button>
            }
          />
          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={format(dict.deleteTaskAriaLabel, { title: task.title })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            }
            title={format(dict.confirmDelete.title, { name: task.title })}
            description={dict.confirmDelete.description}
            cancelLabel={dict.confirmDelete.cancel}
            confirmLabel={dict.confirmDelete.confirm}
            pendingLabel={dict.confirmDelete.confirming}
            onConfirm={() => deleteTaskAction(task.id)}
          />
        </div>
      </div>
    </SwipeRow>
  );
}
