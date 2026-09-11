"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";

type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

// Called from push-notifications-card.tsx right after
// `pushManager.subscribe()` resolves. Upserts by endpoint so re-subscribing
// the same browser (e.g. after clearing its permission) just refreshes the
// keys instead of erroring on the unique constraint.
export async function subscribeToPushAction(sub: PushSubscriptionInput): Promise<void> {
  const userId = await requireUserId();

  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

// Scoped to { endpoint, userId } so a stale endpoint or one belonging to
// another user is silently a no-op instead of throwing — mirrors
// dismissNotificationAction's pattern in src/lib/actions/notifications.ts.
export async function unsubscribeFromPushAction(endpoint: string): Promise<void> {
  const userId = await requireUserId();

  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
}
