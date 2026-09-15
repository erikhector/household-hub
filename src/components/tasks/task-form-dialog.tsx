"use client";

// Unified create/edit form for household tasks (see UX_CONSISTENCY_BACKLOG.md
// item H) — follows ItemFormDialog's shape
// (src/components/inventory/add-item-dialog.tsx) as the reference
// implementation: one component, a `mode: "create" | "edit"` prop, `task`
// only meaningful in edit mode, one <Dialog> wrapping one <form>, the action
// switched by mode, dialog closes on success. Replaces the previously
// separate AddTaskForm/AddTaskDialog (create) and EditTaskDialog (edit) so a
// field added to one now automatically applies to both.
//
// Create submits straight through createTaskAction(prevState, formData).
// updateTaskAction (edit) takes a plain object rather than FormData, so the
// `action` below adapts this same <form>'s FormData into that call for edit
// mode — updateTaskAction's own validation/mutation is untouched.

import { useActionState, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createTaskAction, updateTaskAction } from "@/app/dashboard/tasks/actions";
import type { ActionState } from "@/lib/actions/auth";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MemberOption = { id: string; displayName: string };

type EditableTask = {
  id: string;
  title: string;
  assignedToMemberId: string | null;
  recurrenceIntervalDays: number | null;
};

type TasksDict = Dictionary["tasks"];

const initialState: ActionState = {};
// Base UI's Select doesn't accept an empty-string item value, so "no
// assignee"/"no repeat" need their own sentinels rather than "".
const UNASSIGNED_VALUE = "__unassigned__";
const NO_REPEAT_VALUE = "__no_repeat__";
const RECURRENCE_OPTION_DAYS = [1, 2, 3, 7] as const;

export function TaskFormDialog({
  mode,
  task,
  members,
  dict,
  trigger,
}: {
  mode: "create" | "edit";
  /** Only meaningful (and required in practice) in edit mode. */
  task?: EditableTask;
  members: MemberOption[];
  dict: TasksDict;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [assignedToMemberId, setAssignedToMemberId] = useState(
    mode === "edit" ? (task?.assignedToMemberId ?? UNASSIGNED_VALUE) : UNASSIGNED_VALUE,
  );
  const [recurrence, setRecurrence] = useState(
    mode === "edit" && task?.recurrenceIntervalDays ? String(task.recurrenceIntervalDays) : NO_REPEAT_VALUE,
  );

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setTitle("");
      setAssignedToMemberId(mode === "edit" ? (task?.assignedToMemberId ?? UNASSIGNED_VALUE) : UNASSIGNED_VALUE);
      setRecurrence(
        mode === "edit" && task?.recurrenceIntervalDays ? String(task.recurrenceIntervalDays) : NO_REPEAT_VALUE,
      );
    }
  };

  // create: hand FormData straight to the real server action. edit: adapt
  // this same form's FormData into updateTaskAction's (taskId, input) shape
  // — the sentinel-to-null mapping mirrors exactly what EditTaskDialog's
  // handleSave used to do by hand.
  const action =
    mode === "create"
      ? createTaskAction
      : async (_prevState: ActionState, formData: FormData): Promise<ActionState> => {
          if (!task) return { error: "Task not found" };
          return updateTaskAction(task.id, {
            assignedToMemberId: (formData.get("assignedToMemberId") as string | null) ?? null,
            recurrenceIntervalDays: formData.has("recurrenceIntervalDays")
              ? Number(formData.get("recurrenceIntervalDays"))
              : null,
          });
        };

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await action(prevState, formData);
    if (result.error) return result;
    handleOpenChange(false);
    return {};
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? dict.addTaskDialogTitle : format(dict.editTask.title, { name: task?.title ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {mode === "edit" && task && <input type="hidden" name="taskId" value={task.id} />}
          {mode === "create" && (
            <Input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={dict.addTaskPlaceholder}
              aria-label={dict.addTaskAriaLabel}
              maxLength={120}
            />
          )}
          {(mode === "edit" || members.length > 0) && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-assignee">
                {mode === "edit" ? dict.editTask.assigneeLabel : dict.assigneeLabel}
              </Label>
              <Select value={assignedToMemberId} onValueChange={(v) => setAssignedToMemberId(String(v))}>
                {/* Only submitted when an actual member is picked — the
                    "unassigned" sentinel is a client-only value the server
                    schema doesn't know about (assignedToMemberId is simply
                    omitted, same as any other optional field). */}
                {assignedToMemberId !== UNASSIGNED_VALUE && (
                  <input type="hidden" name="assignedToMemberId" value={assignedToMemberId} />
                )}
                <SelectTrigger id="task-assignee">
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
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-recurrence">
              {mode === "edit" ? dict.editTask.recurrenceLabel : dict.recurrenceLabel}
            </Label>
            <Select value={recurrence} onValueChange={(v) => setRecurrence(String(v))}>
              {/* Same "only submit when it's an actual value" convention as
                  assignedToMemberId above — "doesn't repeat" is simply omitted. */}
              {recurrence !== NO_REPEAT_VALUE && (
                <input type="hidden" name="recurrenceIntervalDays" value={recurrence} />
              )}
              <SelectTrigger id="task-recurrence">
                <SelectValue>
                  {(v: string) =>
                    v === NO_REPEAT_VALUE || v === ""
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
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            {mode === "edit" && (
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
                {dict.editTask.cancel}
              </Button>
            )}
            <Button
              type="submit"
              variant={mode === "create" ? "outline" : "default"}
              disabled={pending || (mode === "create" && title.trim().length === 0)}
            >
              {pending
                ? mode === "create"
                  ? dict.adding
                  : dict.editTask.saving
                : mode === "create"
                  ? dict.add
                  : dict.editTask.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
