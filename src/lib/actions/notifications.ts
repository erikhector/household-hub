"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";

// Clears a single notification from the bell — the only way a notification
// ever disappears now (see src/lib/notifications.ts's doc comment: unlike
// the old live-computed design, nothing auto-resolves). `updateMany` scoped
// to the household (rather than `update`) so an id for another household's
// notification, or one already dismissed, is silently a no-op instead of
// throwing — mirrors deleteInventoryItemAction's pattern.
export async function dismissNotificationAction(notificationId: string): Promise<void> {
  const { household } = await requireHousehold();

  await prisma.notification.updateMany({
    where: { id: notificationId, householdId: household.id, dismissedAt: null },
    data: { dismissedAt: new Date() },
  });

  revalidatePath("/dashboard");
}

// "Mark all as read" for the notification center (see
// src/app/dashboard/notifications/page.tsx) — clears every currently-active
// alert for the household in one go, same as clicking each individually.
export async function dismissAllNotificationsAction(): Promise<void> {
  const { household } = await requireHousehold();

  await prisma.notification.updateMany({
    where: { householdId: household.id, dismissedAt: null },
    data: { dismissedAt: new Date() },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/notifications");
}
