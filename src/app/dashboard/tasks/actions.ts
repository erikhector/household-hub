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

const recurrenceIntervalDaysSchema = z.coerce
  .number()
  .int("Repeat interval must be a whole number of days")
  .min(1, "Repeat interval must be at least 1 day")
  .max(90, "Repeat interval must be 90 days or fewer")
  .nullable()
  .optional();

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120, "Title must be 120 characters or fewer"),
  assignedToMemberId: z.string().trim().min(1).optional(),
  recurrenceIntervalDays: recurrenceIntervalDaysSchema,
});

const updateTaskSchema = z.object({
  assignedToMemberId: z.string().trim().min(1).nullable(),
  recurrenceIntervalDays: recurrenceIntervalDaysSchema,
});

export async function createTaskAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = createTaskSchema.safeParse({
    title: formData.get("title"),
    assignedToMemberId: formData.get("assignedToMemberId") || undefined,
    recurrenceIntervalDays: formData.get("recurrenceIntervalDays") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let assignedToMemberId: string | null = null;
  if (parsed.data.assignedToMemberId) {
    const member = await prisma.householdMember.findFirst({
      where: { id: parsed.data.assignedToMemberId, householdId: household.id },
      select: { id: true },
    });
    if (!member) return { error: "Member not found" };
    assignedToMemberId = member.id;
  }

  try {
    await prisma.householdTask.create({
      data: {
        householdId: household.id,
        title: parsed.data.title,
        assignedToMemberId,
        recurrenceIntervalDays: parsed.data.recurrenceIntervalDays ?? null,
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
  input: { assignedToMemberId: string | null; recurrenceIntervalDays: number | null },
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

  let assignedToMemberId: string | null = null;
  if (parsed.data.assignedToMemberId) {
    const member = await prisma.householdMember.findFirst({
      where: { id: parsed.data.assignedToMemberId, householdId: household.id },
      select: { id: true },
    });
    if (!member) return { error: "Member not found" };
    assignedToMemberId = member.id;
  }

  try {
    await prisma.householdTask.update({
      where: { id: task.id },
      data: {
        assignedToMemberId,
        recurrenceIntervalDays: parsed.data.recurrenceIntervalDays ?? null,
      },
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
    select: { id: true, completedAt: true, recurrenceIntervalDays: true },
  });
  if (!task) return { error: "Task not found" };

  const now = new Date();
  const nextCompleted = isTaskOpen(task, now);

  try {
    if (nextCompleted) {
      const member = await prisma.householdMember.findFirst({
        where: { householdId: household.id, userId },
        select: { id: true },
      });
      await prisma.householdTask.update({
        where: { id: task.id },
        data: { completedAt: now, completedByMemberId: member?.id ?? null },
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
