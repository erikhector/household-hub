"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError } from "@/lib/actions/errors";

// GAP-57: the "tonight's dinner" morning nudge opt-in. Per user, since it
// decides who gets the push (syncTonightsDinnerNudge in
// src/lib/notifications.ts), so it needs only the session's user id, never a
// household id. A click action (a checkbox on the Profile page), so it takes
// the value directly rather than FormData.
export async function setTonightsDinnerNudgeAction(enabled: boolean): Promise<ActionState> {
  const userId = await requireUserId();

  if (typeof enabled !== "boolean") return await fail("invalidInput");

  try {
    await prisma.user.update({ where: { id: userId }, data: { tonightsDinnerNudge: enabled } });
  } catch (error) {
    return await toFriendlyError(error);
  }

  revalidatePath("/dashboard/profile");
  return {};
}

// GAP-74: the "tasks due today" morning push opt-in. Same shape and reasoning
// as the dinner nudge above (syncTaskDueNudge decides who gets the push).
export async function setTaskDueNudgeAction(enabled: boolean): Promise<ActionState> {
  const userId = await requireUserId();

  if (typeof enabled !== "boolean") return await fail("invalidInput");

  try {
    await prisma.user.update({ where: { id: userId }, data: { taskDueNudge: enabled } });
  } catch (error) {
    return await toFriendlyError(error);
  }

  revalidatePath("/dashboard/profile");
  return {};
}
