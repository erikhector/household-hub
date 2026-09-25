"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { isValidTimeZone } from "@/lib/quiet-hours";

type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  // The browser's Intl.DateTimeFormat().resolvedOptions().timeZone (GAP-14).
  // Optional so a client bundle cached from before quiet hours shipped can
  // still subscribe.
  timeZone?: string;
};

// An unrecognised zone is stored as null rather than rejected: subscribing
// must keep working even on a browser with an odd Intl implementation, and a
// null zone simply means quiet hours never apply (see isWithinQuietHours).
function sanitizeTimeZone(timeZone: string | undefined): string | null {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : null;
}

// Called from push-notifications-card.tsx right after
// `pushManager.subscribe()` resolves. Upserts by endpoint so re-subscribing
// the same browser (e.g. after clearing its permission) just refreshes the
// keys instead of erroring on the unique constraint.
export async function subscribeToPushAction(sub: PushSubscriptionInput): Promise<void> {
  const userId = await requireUserId();
  const timeZone = sanitizeTimeZone(sub.timeZone);

  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, timeZone },
    // Quiet hours are left alone on update — re-subscribing refreshes keys
    // and the zone, it isn't a request to reset the user's schedule.
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, timeZone },
  });

  revalidatePath("/dashboard/profile");
}

// Scoped to { endpoint, userId } so a stale endpoint or one belonging to
// another user is silently a no-op instead of throwing — mirrors
// dismissNotificationAction's pattern in src/lib/actions/notifications.ts.
export async function unsubscribeFromPushAction(endpoint: string): Promise<void> {
  const userId = await requireUserId();

  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
}

// Not z.coerce.number(): that turns a missing field (null) or "" into 0,
// which would silently save a window starting or ending at midnight.
const hour = z
  .string()
  .regex(/^\d{1,2}$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(23));

const quietHoursSchema = z.object({
  endpoint: z.string().min(1),
  quietHoursStart: hour,
  quietHoursEnd: hour,
  timeZone: z.string().refine(isValidTimeZone),
});

// Form action behind the quiet-hours picker on PushNotificationsCard.
//
// Tenancy: push subscriptions are per-user, not per-household (see the
// PushSubscription model), so this scopes by requireUserId() like the two
// actions above. The only client-supplied identifier is the browser's own
// push `endpoint`, and the write is an updateMany on { endpoint, userId } —
// an endpoint that belongs to someone else (or no longer exists) matches
// zero rows and is reported as an error, never written.
//
// The time zone is re-captured on every save, not just at subscribe time:
// a subscription created before GAP-14 has none, and a laptop that moved
// time zones since subscribing should have its window follow the user.
// Unlike subscribeToPushAction, an unrecognised zone is rejected here,
// because saving quiet hours that silently never apply would be worse than
// an error message.
export async function setPushQuietHoursAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = quietHoursSchema.safeParse({
    endpoint: formData.get("endpoint"),
    quietHoursStart: formData.get("quietHoursStart"),
    quietHoursEnd: formData.get("quietHoursEnd"),
    timeZone: formData.get("timeZone"),
  });
  if (!parsed.success) return { error: "Invalid quiet hours" };

  const { endpoint, quietHoursStart, quietHoursEnd, timeZone } = parsed.data;
  // Equal hours would be read as "no quiet hours" at send time anyway (see
  // isWithinQuietHours); rejecting it here keeps the stored state honest
  // instead of showing a schedule on the card that never takes effect.
  if (quietHoursStart === quietHoursEnd) return { error: "Start and end must differ" };

  const { count } = await prisma.pushSubscription.updateMany({
    where: { endpoint, userId },
    data: { quietHoursStart, quietHoursEnd, timeZone },
  });
  if (count === 0) return { error: "Subscription not found" };

  revalidatePath("/dashboard/profile");
  return {};
}

// Click action for the card's "Turn off quiet hours" button. Same
// { endpoint, userId } scoping as above, and a no-op for a foreign or stale
// endpoint like unsubscribeFromPushAction. The zone is kept — it's still
// the browser's zone, and it's refreshed on the next save regardless.
export async function clearPushQuietHoursAction(endpoint: string): Promise<void> {
  const userId = await requireUserId();

  await prisma.pushSubscription.updateMany({
    where: { endpoint, userId },
    data: { quietHoursStart: null, quietHoursEnd: null },
  });

  revalidatePath("/dashboard/profile");
}
