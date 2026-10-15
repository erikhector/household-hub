"use client";

// Household Tasks v1 (see docs/archive/JOY_GAP_BACKLOG.md item 6b) — one shared task list
// per household. Mirrors ShoppingListClient's shape: an add-task form, a
// flat list split into an open section and a completed section. Creating and
// editing a task both go through the shared TaskFormDialog (see
// task-form-dialog.tsx) rather than delete-and-re-add.

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
import { TasksWeeklyRecap } from "@/components/tasks/tasks-weekly-recap";
import { applyLocalRowChanges, useLocalRowChanges } from "@/components/shared/local-row-changes";
import { useFlipList } from "@/components/shared/use-flip-list";
import { computeWeeklyTaskRecap } from "@/app/dashboard/tasks/weekly-recap-calc";
import { withLocalCompletion } from "@/lib/task-rotation";
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
  currentMemberId,
  tasks: serverTasks,
  now,
  locale,
}: {
  dict: TasksDict;
  members: MemberOption[];
  /** Who's ticking, for a completion shown before the server answers. */
  currentMemberId: string | null;
  tasks: TaskRow[];
  /** The server's clock, which sets the weekly recap's week. */
  now: Date;
  locale: Locale;
}) {
  const memberNameById = new Map(members.map((m) => [m.id, m.displayName]));

  // UX-33: a tick or a delete shows, and moves its row, at tap time (see
  // local-row-changes.ts); the weekly recap above follows it too. Each save
  // settles on its own, outside any transition, so ticking several chores
  // in a row never waits on (or greys out behind) an earlier save (UX-14),
  // and a failed one moves its row back at once, with a toast.
  const local = useLocalRowChanges(serverTasks);
  const tasks = applyLocalRowChanges(serverTasks, local.changes, (task, completed) =>
    withLocalCompletion(task, completed, currentMemberId, new Date()),
  );
  const toggleCompleted = (task: TaskRow) => {
    const settle = local.markDone(task.id, !task.completed);
    void (async () => {
      const result = await settleOptimisticAction(() => toggleTaskCompletedAction(task.id), dict.saveFailedToast);
      settle(result !== null);
    })();
  };
  // From the row's confirm dialog, which waits on it and toasts an error.
  const deleteTask = async (task: TaskRow) => {
    const settle = local.markDeleted(task.id);
    // A request that never arrives (offline) throws: the row comes back too.
    const result = await deleteTaskAction(task.id).catch((error: unknown) => {
      settle(false);
      throw error;
    });
    settle(!result.error);
    return result;
  };
  const containerRef = useFlipList<HTMLDivElement>();

  const openTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed);
  const recapGroups = computeWeeklyTaskRecap({
    tasks: tasks
      .filter((t) => t.completedAt !== null)
      .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime()),
    now,
  }).map((group) => ({
    memberName: group.completedByMemberId ? (memberNameById.get(group.completedByMemberId) ?? null) : null,
    titles: group.titles,
  }));

  return (
    <div ref={containerRef} className="relative flex flex-col gap-6">
      {recapGroups.length > 0 && <TasksWeeklyRecap groups={recapGroups} dict={dict} />}

      {/* Keyed too, so the list glides down when the recap above grows. */}
      <div data-flip-key="tasks" className="relative flex flex-col gap-2">
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
                onToggleCompleted={toggleCompleted}
                onDelete={deleteTask}
                dict={dict}
                locale={locale}
              />
            ))}
            {completedTasks.length > 0 && (
              <p data-flip-key="label:completed" className="mt-4 text-xs font-medium uppercase text-muted-foreground">
                {dict.completedSectionLabel}
              </p>
            )}
            {completedTasks.map((task) => (
              <TaskItemRow
                key={task.id}
                task={task}
                members={members}
                memberNameById={memberNameById}
                onToggleCompleted={toggleCompleted}
                onDelete={deleteTask}
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
  onToggleCompleted,
  onDelete,
  dict,
  locale,
}: {
  task: TaskRow;
  members: MemberOption[];
  memberNameById: Map<string, string>;
  onToggleCompleted: (task: TaskRow) => void;
  onDelete: (task: TaskRow) => Promise<{ error?: string }>;
  dict: TasksDict;
  locale: Locale;
}) {
  // UX-14 and UX-33: the tick shows, and the row moves to "Completed", at
  // tap time; TasksClient owns the save (toggleCompleted).
  const completed = task.completed;
  const handleToggleCompleted = () => onToggleCompleted(task);
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
      flipKey={task.id}
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
            // UX-33: the row goes at once and comes back if the delete fails.
            onConfirm={() => onDelete(task)}
          />
        </div>
      </div>
    </SwipeRow>
  );
}
