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
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { getTimeZone } from "@/lib/get-time-zone";
import { isTaskOpen } from "@/app/dashboard/tasks/recurrence";
import {
  MAX_ROTATION_MEMBERS,
  MIN_ROTATION_MEMBERS,
  isRotating,
  nextAssigneeInRotation,
} from "@/lib/task-rotation";

const recurrenceIntervalDaysSchema = z.coerce
  .number()
  .int(v("repeatWhole"))
  .min(1, v("repeatMin"))
  .max(90, v("repeatMax"))
  .nullable()
  .optional();

// GAP-38: the ordered "take turns" list. Empty means no rotation. Shape is
// checked here; the cross-field rules (needs a repeat, needs ≥2 people,
// everyone must belong to this household) live in resolveTaskAssignment
// below because they need the other fields and a DB lookup.
const rotationMemberIdsSchema = z
  .array(z.string().trim().min(1))
  .max(MAX_ROTATION_MEMBERS, `Up to ${MAX_ROTATION_MEMBERS} people can take turns`)
  .refine((ids) => new Set(ids).size === ids.length, v("eachPersonOnce"))
  .default([]);

const createTaskSchema = z.object({
  title: z.string().trim().min(1, v("titleRequired")).max(120, v("titleTooLong")),
  assignedToMemberId: z.string().trim().min(1).optional(),
  recurrenceIntervalDays: recurrenceIntervalDaysSchema,
  rotationMemberIds: rotationMemberIdsSchema,
});

const updateTaskSchema = z.object({
  // UX-24: the edit dialog can rename a task. Optional so a caller that only
  // reassigns or re-repeats leaves the title alone.
  title: createTaskSchema.shape.title.optional(),
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
    if (recurrenceIntervalDays === null) return await fail("onlyRepeatingTurns");
    if (rotationMemberIds.length < MIN_ROTATION_MEMBERS) {
      return await fail("pickTwoPeople");
    }
    const found = await prisma.householdMember.findMany({
      where: { id: { in: rotationMemberIds }, householdId },
      select: { id: true },
    });
    if (found.length !== rotationMemberIds.length) return await fail("memberNotFound");

    if (assignedToMemberId === null) {
      assignedToMemberId = rotationMemberIds[0];
    } else if (!rotationMemberIds.includes(assignedToMemberId)) {
      return await fail("assigneeMustTakeTurns");
    }
  }

  if (assignedToMemberId) {
    const member = await prisma.householdMember.findFirst({
      where: { id: assignedToMemberId, householdId },
      select: { id: true },
    });
    if (!member) return await fail("memberNotFound");
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
    return await zodFail(parsed.error);
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
  input: { title?: string; assignedToMemberId: string | null; recurrenceIntervalDays: number | null; rotationMemberIds: string[] },
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const task = await prisma.householdTask.findFirst({
    where: { id: taskId, householdId: household.id },
    select: { id: true },
  });
  if (!task) return await fail("taskNotFound");

  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) {
    return await zodFail(parsed.error);
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
      data: { ...resolved.data, ...(parsed.data.title !== undefined && { title: parsed.data.title }) },
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
      completedByMemberId: true,
      previousCompletedAt: true,
      previousCompletedByMemberId: true,
      recurrenceIntervalDays: true,
      createdAt: true,
      assignedToMemberId: true,
      rotationMemberIds: true,
      rotationPreviousAssigneeId: true,
    },
  });
  if (!task) return await fail("taskNotFound");

  const now = new Date();
  const nextCompleted = isTaskOpen(task, now, await getTimeZone());
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
        data: {
          completedAt: now,
          completedByMemberId: member?.id ?? null,
          // UX-102: park the completion this tick overwrites (null for a
          // never-done task) so un-ticking can put it back.
          previousCompletedAt: task.completedAt,
          previousCompletedByMemberId: task.completedByMemberId,
          ...rotationData,
        },
      });
    } else {
      // Un-completing is an undo, so it puts back exactly what the tick
      // overwrote (UX-102): the earlier completedAt and its completer, or
      // null for both when the task had never been done. Otherwise an
      // accidental tick-untick leaves a permanent "Last done by" on a
      // never-done task, and unticking a recurring task credits the wrong
      // person and loses its real last completion. The stored completer
      // has no FK, so restore it only if that person is still in the
      // household; otherwise it reads as no one, as onDelete: SetNull
      // would have for completedByMemberId itself.
      let restoredBy: string | null = null;
      if (task.previousCompletedByMemberId) {
        const previousCompleter = await prisma.householdMember.findFirst({
          where: { id: task.previousCompletedByMemberId, householdId: household.id },
          select: { id: true },
        });
        restoredBy = previousCompleter?.id ?? null;
      }
      const restoreData = {
        completedAt: task.previousCompletedAt,
        completedByMemberId: restoredBy,
        previousCompletedAt: null,
        previousCompletedByMemberId: null,
      };
      if (rotating) {
        // Also hand the turn back to whoever had it before the completion
        // advanced it, rather than advancing again ("Undo over confirm"
        // only works if undo really puts things back). Same membership
        // check as above, for the same no-FK reason.
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
          data: { ...restoreData, assignedToMemberId: previous },
        });
      } else {
        await prisma.householdTask.updateMany({ where: unchangedSinceRead, data: restoreData });
      }
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
