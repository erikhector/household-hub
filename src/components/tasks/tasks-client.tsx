"use client";

// Household Tasks v1 (see JOY_GAP_BACKLOG.md item 6b) — one shared task list
// per household. Mirrors ShoppingListClient's shape: an add-task form, a
// flat list split into an open section and a completed section. Editing an
// existing task's assignee/recurrence goes through EditTaskDialog (see that
// file) rather than delete-and-re-add.

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Repeat, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createTaskAction, deleteTaskAction, toggleTaskCompletedAction } from "@/app/dashboard/tasks/actions";
import { EditTaskDialog } from "@/components/tasks/edit-task-dialog";
import { TasksWeeklyRecap, type WeeklyRecapGroupView } from "@/components/tasks/tasks-weekly-recap";
import type { ActionState } from "@/lib/actions/auth";
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

const initialState: ActionState = {};
// Base UI's Select doesn't accept an empty-string item value, so "no
// assignee"/"no repeat" need their own sentinels rather than "".
const UNASSIGNED_VALUE = "__unassigned__";
const NO_REPEAT_VALUE = "__no_repeat__";
const RECURRENCE_OPTION_DAYS = [1, 2, 3, 7] as const;

function AddTaskForm({
  members,
  dict,
  onSuccess,
}: {
  members: MemberOption[];
  dict: TasksDict;
  onSuccess?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [assignedToMemberId, setAssignedToMemberId] = useState(UNASSIGNED_VALUE);
  const [recurrence, setRecurrence] = useState(NO_REPEAT_VALUE);

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await createTaskAction(prevState, formData);
    if (!result.error) {
      setTitle("");
      setAssignedToMemberId(UNASSIGNED_VALUE);
      setRecurrence(NO_REPEAT_VALUE);
      onSuccess?.();
    }
    return result;
  }, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={dict.addTaskPlaceholder}
          aria-label={dict.addTaskAriaLabel}
          maxLength={120}
          className="min-w-0 flex-1 basis-full sm:basis-auto"
        />
        {members.length > 0 && (
          <Select value={assignedToMemberId} onValueChange={(v) => setAssignedToMemberId(String(v))}>
            {/* Only submitted when an actual member is picked — the
                "unassigned" sentinel is a client-only value the server
                schema doesn't know about (assignedToMemberId is simply
                omitted, same as any other optional field). */}
            {assignedToMemberId !== UNASSIGNED_VALUE && (
              <input type="hidden" name="assignedToMemberId" value={assignedToMemberId} />
            )}
            <SelectTrigger className="w-40">
              <SelectValue>
                {(v: string) => members.find((m) => m.id === v)?.displayName ?? dict.unassignedOption}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED_VALUE}>{dict.unassignedOption}</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={recurrence} onValueChange={(v) => setRecurrence(String(v))}>
          {/* Same "only submit when it's an actual value" convention as
              assignedToMemberId above — "doesn't repeat" is simply omitted. */}
          {recurrence !== NO_REPEAT_VALUE && (
            <input type="hidden" name="recurrenceIntervalDays" value={recurrence} />
          )}
          <SelectTrigger className="w-40" aria-label={dict.recurrenceAriaLabel}>
            <SelectValue>
              {(v: string) =>
                v === NO_REPEAT_VALUE
                  ? dict.noRepeatOption
                  : format(plural(Number(v), dict.recurrenceOption), { count: Number(v) })
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_REPEAT_VALUE}>{dict.noRepeatOption}</SelectItem>
            {RECURRENCE_OPTION_DAYS.map((days) => (
              <SelectItem key={days} value={String(days)}>
                {format(plural(days, dict.recurrenceOption), { count: days })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" disabled={pending || title.trim().length === 0}>
          {pending ? dict.adding : dict.add}
        </Button>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

// "+"-button-triggered create dialog, matching Inventory/Recipes (see
// UX_CONSISTENCY_BACKLOG.md item F) — structured after EditTaskDialog's
// Dialog shell. AddTaskForm's fields/validation/action are untouched; this
// just relocates them behind a modal and closes it on successful create.
function AddTaskDialog({ members, dict }: { members: MemberOption[]; dict: TasksDict }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="gap-1.5">
            <Plus className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.addTask}</span>
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.addTaskDialogTitle}</DialogTitle>
        </DialogHeader>
        <AddTaskForm members={members} dict={dict} onSuccess={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

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
        <AddTaskDialog members={members} dict={dict} />
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
        <EditTaskDialog
          task={task}
          members={members}
          dict={dict}
          editAriaLabel={format(dict.editTaskAriaLabel, { title: task.title })}
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
