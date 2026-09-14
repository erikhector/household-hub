"use server";

// Household Tasks v1 (see JOY_GAP_BACKLOG.md item 6a) — a shared task list for
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

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120, "Title must be 120 characters or fewer"),
  assignedToMemberId: z.string().trim().min(1).optional(),
});

export async function createTaskAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = createTaskSchema.safeParse({
    title: formData.get("title"),
    assignedToMemberId: formData.get("assignedToMemberId") || undefined,
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
    select: { id: true, completedAt: true },
  });
  if (!task) return { error: "Task not found" };

  const nextCompleted = task.completedAt === null;

  let completedByMemberId: string | null = null;
  if (nextCompleted) {
    const member = await prisma.householdMember.findFirst({
      where: { householdId: household.id, userId },
      select: { id: true },
    });
    completedByMemberId = member?.id ?? null;
  }

  try {
    await prisma.householdTask.update({
      where: { id: task.id },
      data: {
        completedAt: nextCompleted ? new Date() : null,
        completedByMemberId,
      },
    });
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
