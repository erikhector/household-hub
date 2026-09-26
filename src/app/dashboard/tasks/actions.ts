"use server";

// Household Tasks v1 (see docs/archive/JOY_GAP_BACKLOG.md item 6a) — a shared task list for
// adult household co-managers. Every action follows the household-scoping
// convention used throughout the app (requireHousehold() first, every
// query/mutation filtered by householdId, never trust a client-supplied
// member/task id without checking it belongs to this household).

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { isTaskOpen } from "@/app/dashboard/tasks/recurrence";
import {
  MAX_ROTATION_MEMBERS,
  MIN_ROTATION_MEMBERS,
  isRotating,
  nextAssigneeInRotation,
} from "@/lib/task-rotation";

const recurrenceIntervalDaysSchema = z.coerce
  .number()
  .int("Repeat interval must be a whole number of days")
  .min(1, "Repeat interval must be at least 1 day")
  .max(90, "Repeat interval must be 90 days or fewer")
  .nullable()
  .optional();

// GAP-38: the ordered "take turns" list. Empty means no rotation. Shape is
// checked here; the cross-field rules (needs a repeat, needs ≥2 people,
// everyone must belong to this household) live in resolveTaskAssignment
// below because they need the other fields and a DB lookup.
const rotationMemberIdsSchema = z
  .array(z.string().trim().min(1))
  .max(MAX_ROTATION_MEMBERS, `Up to ${MAX_ROTATION_MEMBERS} people can take turns`)
  .refine((ids) => new Set(ids).size === ids.length, "Each person can only take turns once")
  .default([]);

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120, "Title must be 120 characters or fewer"),
  assignedToMemberId: z.string().trim().min(1).optional(),
  recurrenceIntervalDays: recurrenceIntervalDaysSchema,
  rotationMemberIds: rotationMemberIdsSchema,
});

const updateTaskSchema = z.object({
  assignedToMemberId: z.string().trim().min(1).nullable(),
  recurrenceIntervalDays: recurrenceIntervalDaysSchema,
  rotationMemberIds: rotationMemberIdsSchema,
});

type TaskAssignment = {
  assignedToMemberId: string | null;
  recurrenceIntervalDays: number | null;
  rotationMemberIds: string[];
  rotationPreviousAssigneeId: string | null;
};

/**
 * Shared by create and update: validates the assignee and the rotation
 * against the session household and returns the fields to write. Every
 * member id comes from the client, so each one is checked to belong to
 * `householdId` — never trusted as-is.
 *
 * With a rotation, the assignee is "whose turn it is now", so it must be one
 * of the people taking turns (defaulting to the first of them when left
 * unassigned). `rotationPreviousAssigneeId` is reset to that same explicit
 * choice, so un-completing after an edit restores what was just saved rather
 * than whoever had the task before the edit (see toggleTaskCompletedAction).
 */
async function resolveTaskAssignment(
  householdId: string,
  input: { assignedToMemberId: string | null; recurrenceIntervalDays: number | null; rotationMemberIds: string[] },
): Promise<{ error: string } | { data: TaskAssignment }> {
  const { recurrenceIntervalDays, rotationMemberIds } = input;
  let assignedToMemberId = input.assignedToMemberId;

  if (rotationMemberIds.length > 0) {
    if (recurrenceIntervalDays === null) return { error: "Only repeating tasks can take turns" };
    if (rotationMemberIds.length < MIN_ROTATION_MEMBERS) {
      return { error: "Pick at least two people to take turns" };
    }
    const found = await prisma.householdMember.findMany({
      where: { id: { in: rotationMemberIds }, householdId },
      select: { id: true },
    });
    if (found.length !== rotationMemberIds.length) return { error: "Member not found" };

    if (assignedToMemberId === null) {
      assignedToMemberId = rotationMemberIds[0];
    } else if (!rotationMemberIds.includes(assignedToMemberId)) {
      return { error: "The person assigned must be one of the people taking turns" };
    }
  }

  if (assignedToMemberId) {
    const member = await prisma.householdMember.findFirst({
      where: { id: assignedToMemberId, householdId },
      select: { id: true },
    });
    if (!member) return { error: "Member not found" };
    assignedToMemberId = member.id;
  }

  return {
    data: {
      assignedToMemberId,
      recurrenceIntervalDays,
      rotationMemberIds,
      rotationPreviousAssigneeId: rotationMemberIds.length > 0 ? assignedToMemberId : null,
    },
  };
}

export async function createTaskAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = createTaskSchema.safeParse({
    title: formData.get("title"),
    assignedToMemberId: formData.get("assignedToMemberId") || undefined,
    recurrenceIntervalDays: formData.get("recurrenceIntervalDays") || undefined,
    // One hidden input per person, in turn order — getAll keeps that order.
    rotationMemberIds: formData.getAll("rotationMemberIds"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const resolved = await resolveTaskAssignment(household.id, {
    assignedToMemberId: parsed.data.assignedToMemberId ?? null,
    recurrenceIntervalDays: parsed.data.recurrenceIntervalDays ?? null,
    rotationMemberIds: parsed.data.rotationMemberIds,
  });
  if ("error" in resolved) return { error: resolved.error };

  try {
    await prisma.householdTask.create({
      data: {
        householdId: household.id,
        title: parsed.data.title,
        ...resolved.data,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/tasks");
  return {};
}

export async function updateTaskAction(
  taskId: string,
  input: { assignedToMemberId: string | null; recurrenceIntervalDays: number | null; rotationMemberIds: string[] },
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const task = await prisma.householdTask.findFirst({
    where: { id: taskId, householdId: household.id },
    select: { id: true },
  });
  if (!task) return { error: "Task not found" };

  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const resolved = await resolveTaskAssignment(household.id, {
    assignedToMemberId: parsed.data.assignedToMemberId,
    recurrenceIntervalDays: parsed.data.recurrenceIntervalDays ?? null,
    rotationMemberIds: parsed.data.rotationMemberIds,
  });
  if ("error" in resolved) return { error: resolved.error };

  try {
    await prisma.householdTask.update({
      where: { id: task.id },
      data: resolved.data,
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/tasks");
  return {};
}

export async function toggleTaskCompletedAction(taskId: string): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const task = await prisma.householdTask.findFirst({
    where: { id: taskId, householdId: household.id },
    select: {
      id: true,
      completedAt: true,
      recurrenceIntervalDays: true,
      assignedToMemberId: true,
      rotationMemberIds: true,
      rotationPreviousAssigneeId: true,
    },
  });
  if (!task) return { error: "Task not found" };

  const now = new Date();
  const nextCompleted = isTaskOpen(task, now);
  const rotating = isRotating(task);
  // Compare-and-set: the completion and rotating-undo writes below only
  // apply if the task still has the `completedAt` read above. Without it,
  // two members ticking the same rotating task at once (or one double-tap)
  // would both see it open and advance the turn twice, skipping someone.
  // A write that matches nothing means someone else already toggled it, so
  // it's treated as a no-op success rather than an error — the revalidate
  // below still refreshes the caller's stale view.
  const unchangedSinceRead = { id: task.id, householdId: household.id, completedAt: task.completedAt };

  try {
    if (nextCompleted) {
      const member = await prisma.householdMember.findFirst({
        where: { householdId: household.id, userId },
        select: { id: true },
      });
      // GAP-38: a rotating task passes to the next person the moment it's
      // done, not when it reopens. Reopening is derived lazily at read time
      // (recurrence.ts) and never writes, so this is the only write there
      // is — and it means the next person sees it on their dashboard's "my
      // tasks" as soon as it's theirs. The turn advances from the
      // *assignee*, not the completer: helping out on someone else's turn
      // doesn't reorder the rotation.
      let rotationData = {};
      if (rotating) {
        const members = await prisma.householdMember.findMany({
          where: { householdId: household.id },
          select: { id: true },
        });
        rotationData = {
          assignedToMemberId: nextAssigneeInRotation({
            rotation: task.rotationMemberIds,
            currentAssigneeId: task.assignedToMemberId,
            activeMemberIds: members.map((m) => m.id),
          }),
          rotationPreviousAssigneeId: task.assignedToMemberId,
        };
      }
      await prisma.householdTask.updateMany({
        where: unchangedSinceRead,
        data: { completedAt: now, completedByMemberId: member?.id ?? null, ...rotationData },
      });
    } else if (rotating) {
      // Un-completing a rotating task is an undo: hand the turn back to
      // whoever had it before the completion advanced it, rather than
      // advancing again ("Undo over confirm" only works if undo really puts
      // things back). The stored id has no FK, so only restore it if that
      // person is still in the household — otherwise leave it unassigned,
      // same as onDelete: SetNull would have for the assignee itself.
      let previous: string | null = null;
      if (task.rotationPreviousAssigneeId) {
        const member = await prisma.householdMember.findFirst({
          where: { id: task.rotationPreviousAssigneeId, householdId: household.id },
          select: { id: true },
        });
        previous = member?.id ?? null;
      }
      await prisma.householdTask.updateMany({
        where: unchangedSinceRead,
        data: { completedAt: null, assignedToMemberId: previous },
      });
    } else {
      // Un-completing: only clear completedAt so isTaskOpen (which is what
      // "completed" is derived from) sees it as open again.
      // completedByMemberId is deliberately left as-is rather than nulled
      // out — it's still accurate "last done by" history until the task is
      // completed again, and the UI now shows it even while the task is
      // open (see TaskItemRow's lastCompletedByLabel). There's no separate
      // history field to move it to without a schema change — HouseholdTask
      // only has the one completedAt/completedByMemberId pair, which does
      // double duty as both "is this currently open" state and "last
      // completion" history.
      await prisma.householdTask.update({
        where: { id: task.id },
        data: { completedAt: null },
      });
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/tasks");
  return {};
}

export async function deleteTaskAction(taskId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.householdTask.deleteMany({
      where: { id: taskId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/tasks");
  return {};
}
