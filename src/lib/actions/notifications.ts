"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";

// Clears a single notification from the bell — the only way a notification
// ever disappears now (see src/lib/notifications.ts's doc comment: unlike
// the old live-computed design, nothing auto-resolves). `updateMany` scoped
// to the household (rather than `update`) so an id for another household's
// notification, or one already dismissed, is silently a no-op instead of
// throwing — mirrors deleteInventoryItemAction's pattern.
//
// MAINT-6: a failed write comes back as `{ error }` rather than throwing,
// because both callers run it inside a transition, where a throw lands on
// the error boundary and takes the whole page down for a bell tap.
export async function dismissNotificationAction(notificationId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.notification.updateMany({
      where: { id: notificationId, householdId: household.id, dismissedAt: null },
      data: { dismissedAt: new Date() },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard");
  return {};
}

// "Mark all as read" for the notification center (see
// src/app/dashboard/notifications/page.tsx) — clears every currently-active
// alert for the household in one go, same as clicking each individually.
export async function dismissAllNotificationsAction(): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.notification.updateMany({
      where: { householdId: household.id, dismissedAt: null },
      data: { dismissedAt: new Date() },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/notifications");
  return {};
}
