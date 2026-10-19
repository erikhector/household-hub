"use client";

// Unified create/edit form for household tasks (see docs/archive/UX_CONSISTENCY_BACKLOG.md
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
// mode, including the title (UX-24: edit can rename), which updateTaskAction
// validates with the same rules as create.
//
// GAP-38: once a task repeats, "Take turns" lets you line up two or more
// people; completing it passes it to the next one (see
// src/lib/task-rotation.ts). The order is the order of the hidden
// `rotationMemberIds` inputs, which FormData.getAll preserves. While a
// rotation is set, "Assign to" becomes "whose turn it is now" and only
// offers the people taking turns, matching what the server enforces.

import { useActionState, useState, type ReactElement } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
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
import { MIN_ROTATION_MEMBERS } from "@/lib/task-rotation";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MemberOption = { id: string; displayName: string };

type EditableTask = {
  id: string;
  title: string;
  assignedToMemberId: string | null;
  recurrenceIntervalDays: number | null;
  rotationMemberIds: string[];
};

type TasksDict = Dictionary["tasks"];

const initialState: ActionState = {};
// Base UI's Select doesn't accept an empty-string item value, so "no
// assignee"/"no repeat" need their own sentinels rather than "".
// Same cap as the server schema (tasks/actions.ts). The counter appears 20
// characters before it so the limit is never a surprise (UX-107).
const TITLE_MAX_LENGTH = 120;
const TITLE_COUNTER_FROM = 100;
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
  const [title, setTitle] = useState(mode === "edit" ? (task?.title ?? "") : "");
  const showTitleCounter = title.length >= TITLE_COUNTER_FROM;
  const [assignedToMemberId, setAssignedToMemberId] = useState(
    mode === "edit" ? (task?.assignedToMemberId ?? UNASSIGNED_VALUE) : UNASSIGNED_VALUE,
  );
  const [recurrence, setRecurrence] = useState(
    mode === "edit" && task?.recurrenceIntervalDays ? String(task.recurrenceIntervalDays) : NO_REPEAT_VALUE,
  );
  const [rotation, setRotation] = useState<string[]>(mode === "edit" ? (task?.rotationMemberIds ?? []) : []);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setTitle(mode === "edit" ? (task?.title ?? "") : "");
      setAssignedToMemberId(mode === "edit" ? (task?.assignedToMemberId ?? UNASSIGNED_VALUE) : UNASSIGNED_VALUE);
      setRecurrence(
        mode === "edit" && task?.recurrenceIntervalDays ? String(task.recurrenceIntervalDays) : NO_REPEAT_VALUE,
      );
      setRotation(mode === "edit" ? (task?.rotationMemberIds ?? []) : []);
    }
  };

  const memberName = (id: string) => members.find((m) => m.id === id)?.displayName ?? id;
  const repeats = recurrence !== NO_REPEAT_VALUE;
  // Taking turns only makes sense on a repeating task with at least two
  // people in the household to take them.
  const canRotate = repeats && members.length >= MIN_ROTATION_MEMBERS;
  const rotating = canRotate && rotation.length >= MIN_ROTATION_MEMBERS;
  // While rotating, the assignee is whose turn it is now, so it has to be
  // one of the people in the rotation — fall back to the first of them
  // rather than submitting a choice the server would reject.
  const effectiveAssignee =
    rotating && !rotation.includes(assignedToMemberId) ? rotation[0] : assignedToMemberId;
  const assigneeOptions = rotating ? members.filter((m) => rotation.includes(m.id)) : members;
  const membersNotInRotation = members.filter((m) => !rotation.includes(m.id));

  const moveRotationMember = (index: number, delta: -1 | 1) =>
    setRotation((current) => {
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });

  // create: hand FormData straight to the real server action. edit: adapt
  // this same form's FormData into updateTaskAction's (taskId, input) shape
  // — the sentinel-to-null mapping mirrors exactly what EditTaskDialog's
  // handleSave used to do by hand.
  const action =
    mode === "create"
      ? createTaskAction
      : async (_prevState: ActionState, formData: FormData): Promise<ActionState> => {
          if (!task) return { error: dict.editTask.notFound };
          return updateTaskAction(task.id, {
            title: String(formData.get("title") ?? ""),
            assignedToMemberId: (formData.get("assignedToMemberId") as string | null) ?? null,
            recurrenceIntervalDays: formData.has("recurrenceIntervalDays")
              ? Number(formData.get("recurrenceIntervalDays"))
              : null,
            rotationMemberIds: formData.getAll("rotationMemberIds").map(String),
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-title">{dict.addTaskAriaLabel}</Label>
            <Input
              id="task-title"
              enterKeyHint="done"
              autoComplete="off"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={dict.addTaskPlaceholder}
              maxLength={TITLE_MAX_LENGTH}
              aria-describedby={showTitleCounter ? "task-title-counter" : undefined}
            />
            {/* UX-107: maxLength stops input without a word, so say how close
                the title is to the limit from TITLE_COUNTER_FROM on. role=status
                announces it politely; at the limit it turns destructive. */}
            {showTitleCounter && (
              <p
                id="task-title-counter"
                role="status"
                className={`text-xs ${title.length >= TITLE_MAX_LENGTH ? "text-destructive" : "text-muted-foreground"}`}
              >
                {format(dict.titleCounter, { count: title.length, max: TITLE_MAX_LENGTH })}
              </p>
            )}
          </div>
          {(mode === "edit" || members.length > 0) && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-assignee">
                {rotating
                  ? dict.rotationCurrentLabel
                  : mode === "edit"
                    ? dict.editTask.assigneeLabel
                    : dict.assigneeLabel}
              </Label>
              <Select value={effectiveAssignee} onValueChange={(v) => setAssignedToMemberId(String(v))}>
                {/* Only submitted when an actual member is picked — the
                    "unassigned" sentinel is a client-only value the server
                    schema doesn't know about (assignedToMemberId is simply
                    omitted, same as any other optional field). */}
                {effectiveAssignee !== UNASSIGNED_VALUE && (
                  <input type="hidden" name="assignedToMemberId" value={effectiveAssignee} />
                )}
                <SelectTrigger id="task-assignee">
                  <SelectValue>
                    {(v: string) => members.find((m) => m.id === v)?.displayName ?? dict.unassignedOption}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {!rotating && <SelectItem value={UNASSIGNED_VALUE}>{dict.unassignedOption}</SelectItem>}
                  {assigneeOptions.map((m) => (
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
          {canRotate && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-rotation-add">{dict.rotationLabel}</Label>
              <p className="text-xs text-muted-foreground">{dict.rotationHint}</p>
              {rotation.length > 0 && (
                <ol className="flex flex-col gap-1">
                  {rotation.map((id, index) => (
                    <li key={id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                      {/* Only submitted while it's a real rotation (repeats,
                          2+ people). A lone leftover person — e.g. after the
                          other one left the household — then saves as "no
                          rotation" instead of blocking every save with the
                          server's "at least two" error; the rotationNeedsTwo
                          hint below says why. */}
                      {rotating && <input type="hidden" name="rotationMemberIds" value={id} />}
                      <span className="w-5 shrink-0 text-xs text-muted-foreground">{index + 1}.</span>
                      <span className="flex-1 line-clamp-2 break-words sm:line-clamp-1 text-sm">{memberName(id)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={index === 0}
                        aria-label={format(dict.rotationMoveUpAriaLabel, { name: memberName(id) })}
                        onClick={() => moveRotationMember(index, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={index === rotation.length - 1}
                        aria-label={format(dict.rotationMoveDownAriaLabel, { name: memberName(id) })}
                        onClick={() => moveRotationMember(index, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={format(dict.rotationRemoveAriaLabel, { name: memberName(id) })}
                        onClick={() => setRotation((current) => current.filter((m) => m !== id))}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
              {membersNotInRotation.length > 0 && (
                // Picking a name appends it and the select goes straight back
                // to its placeholder, so it works as an "add" button rather
                // than holding a value of its own.
                <Select
                  value={null}
                  onValueChange={(v) => {
                    if (v) setRotation((current) => [...current, String(v)]);
                  }}
                >
                  <SelectTrigger id="task-rotation-add">
                    <SelectValue placeholder={dict.rotationAddPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {membersNotInRotation.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {rotation.length === 1 && (
                <p className="text-xs text-muted-foreground">{dict.rotationNeedsTwo}</p>
              )}
            </div>
          )}
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            {/* One footer for both modes (UX-24): Cancel beside the one
                primary action. */}
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              {dict.editTask.cancel}
            </Button>
            <Button type="submit" disabled={pending || title.trim().length === 0}>
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
