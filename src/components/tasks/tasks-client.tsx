"use client";

// Household Tasks v1 (see JOY_GAP_BACKLOG.md item 6b) — one shared task list
// per household. Mirrors ShoppingListClient's shape: an add-task form, a
// flat list split into an open section and a completed section. Creating and
// editing a task both go through the shared TaskFormDialog (see
// task-form-dialog.tsx) rather than delete-and-re-add.

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Repeat, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteTaskAction, toggleTaskCompletedAction } from "@/app/dashboard/tasks/actions";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { TasksWeeklyRecap, type WeeklyRecapGroupView } from "@/components/tasks/tasks-weekly-recap";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MemberOption = { id: string; displayName: string };

type TaskRow = {
  id: string;
  title: string;
  assignedToMemberId: string | null;
  completedByMemberId: string | null;
  completed: boolean;
  recurrenceIntervalDays: number | null;
};

type TasksDict = Dictionary["tasks"];

export function TasksClient({
  dict,
  members,
  tasks,
  recapGroups,
}: {
  dict: TasksDict;
  members: MemberOption[];
  tasks: TaskRow[];
  recapGroups: WeeklyRecapGroupView[];
}) {
  const [isPending, startTransition] = useTransition();
  const memberNameById = new Map(members.map((m) => [m.id, m.displayName]));

  const openTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dict.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
        </div>
        <TaskFormDialog
          mode="create"
          members={members}
          dict={dict}
          trigger={
            <Button className="gap-1.5">
              <Plus className="size-4" />
              <span className="sr-only sm:not-sr-only">{dict.addTask}</span>
            </Button>
          }
        />
      </div>

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
                isPending={isPending}
                startTransition={startTransition}
                dict={dict}
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
                isPending={isPending}
                startTransition={startTransition}
                dict={dict}
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
  isPending,
  startTransition,
  dict,
}: {
  task: TaskRow;
  members: MemberOption[];
  memberNameById: Map<string, string>;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
  dict: TasksDict;
}) {
  const assigneeName = task.assignedToMemberId ? memberNameById.get(task.assignedToMemberId) : undefined;
  const completerName = task.completedByMemberId ? memberNameById.get(task.completedByMemberId) : undefined;
  const recurrenceLabel = task.recurrenceIntervalDays
    ? format(plural(task.recurrenceIntervalDays, dict.recurrenceBadge), { count: task.recurrenceIntervalDays })
    : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
      {/* basis-full forces the title onto its own line on narrow screens —
          otherwise the recurrence/assignee badges and the edit/delete
          buttons (all shrink-0) crowd the flex-1 title span down to just a
          few visible characters. */}
      <label className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
        <Checkbox
          checked={task.completed}
          disabled={isPending}
          aria-label={format(dict.toggleCompleteAriaLabel, { title: task.title })}
          onChange={() =>
            startTransition(async () => {
              const result = await toggleTaskCompletedAction(task.id);
              if (result.error) toast.error(result.error);
            })
          }
        />
        <span
          className={`min-w-0 flex-1 truncate ${task.completed ? "text-muted-foreground line-through" : ""}`}
          title={task.title}
        >
          {task.title}
        </span>
      </label>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {recurrenceLabel && (
          <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
            <Repeat className="size-3" />
            {recurrenceLabel}
          </Badge>
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
        <TaskFormDialog
          mode="edit"
          task={task}
          members={members}
          dict={dict}
          trigger={
            <Button
              variant="ghost"
              size="icon"
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
              disabled={isPending}
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
  );
}
