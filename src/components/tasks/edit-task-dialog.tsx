"use client";

// Lets an existing task's assignee and/or recurrence be changed without
// delete-and-re-add — mirrors EditShoppingItemDialog's shape (a pencil icon
// opening a Dialog, one updateTaskAction call on Save). See
// src/app/dashboard/tasks/recurrence.ts for what "recurrence" means here.

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { updateTaskAction } from "@/app/dashboard/tasks/actions";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MemberOption = { id: string; displayName: string };

type EditableTask = {
  id: string;
  title: string;
  assignedToMemberId: string | null;
  recurrenceIntervalDays: number | null;
};

// Base UI's Select doesn't accept an empty-string item value, so these need
// their own sentinels rather than "" (same convention as AddTaskForm's
// UNASSIGNED_VALUE in tasks-client.tsx).
const UNASSIGNED_VALUE = "__unassigned__";
const NO_REPEAT_VALUE = "__no_repeat__";
const RECURRENCE_OPTION_DAYS = [1, 2, 3, 7] as const;

export function EditTaskDialog({
  task,
  members,
  dict,
  editAriaLabel,
}: {
  task: EditableTask;
  members: MemberOption[];
  dict: Dictionary["tasks"];
  editAriaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [assignedToMemberId, setAssignedToMemberId] = useState(task.assignedToMemberId ?? UNASSIGNED_VALUE);
  const [recurrence, setRecurrence] = useState(
    task.recurrenceIntervalDays ? String(task.recurrenceIntervalDays) : NO_REPEAT_VALUE,
  );

  function resetState() {
    setAssignedToMemberId(task.assignedToMemberId ?? UNASSIGNED_VALUE);
    setRecurrence(task.recurrenceIntervalDays ? String(task.recurrenceIntervalDays) : NO_REPEAT_VALUE);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) resetState();
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateTaskAction(task.id, {
        assignedToMemberId: assignedToMemberId === UNASSIGNED_VALUE ? null : assignedToMemberId,
        recurrenceIntervalDays: recurrence === NO_REPEAT_VALUE ? null : Number(recurrence),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={editAriaLabel}
          >
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(dict.editTask.title, { name: task.title })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-task-assignee">{dict.editTask.assigneeLabel}</Label>
            <Select value={assignedToMemberId} onValueChange={(v) => setAssignedToMemberId(String(v))}>
              <SelectTrigger id="edit-task-assignee">
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-task-recurrence">{dict.editTask.recurrenceLabel}</Label>
            <Select value={recurrence} onValueChange={(v) => setRecurrence(String(v))}>
              <SelectTrigger id="edit-task-recurrence">
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {dict.editTask.cancel}
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending}>
            {pending ? dict.editTask.saving : dict.editTask.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
