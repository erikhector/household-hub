// Sends real device/OS push notifications on top of the in-app bell (see
// src/lib/notifications.ts's doc comment for the notification center this
// extends). Subscriptions are stored per-user by src/lib/actions/push.ts;
// service worker at src/lib/service-worker.js is what actually shows the
// notification and handles a click.

import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { isWithinQuietHours } from "@/lib/quiet-hours";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

// Without both keys set, every send below is a silent no-op — same
// fails-gracefully pattern as RESEND_API_KEY in src/lib/email.ts. See
// .env.example for how to generate a key pair.
const configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (configured) {
  webpush.setVapidDetails(process.env.APP_URL || "mailto:support@squirrel.app", VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
}

type PushPayload = {
  title: string;
  body: string;
  // Opened by the service worker's notificationclick handler — mirrors
  // notificationHref() in src/components/notifications/notification-bell.tsx.
  url: string;
};

// Best-effort fan-out to every push subscription belonging to the
// household's members. Never throws.
//
// recordOutOfStockTransition/recordListClearedTransition (src/lib/notifications.ts)
// hand this to `after()` (next/server) rather than awaiting it, since some of
// their call sites run inside a Prisma $transaction and awaiting a network
// call there would hold the transaction open. after() runs it once the
// response is sent and keeps the invocation alive until it settles (PERF-9),
// which a bare `void` promise did not. Push delivery has no guarantee from
// the Push API itself either way, so losing a send if the surrounding write
// later rolls back is an acceptable trade for not blocking on network I/O
// mid-transaction.
//
// syncMealNotLoggedNotifications/syncExpiringSoonNotifications (also in
// notifications.ts), by contrast, DO await this — they only ever run from
// `/api/cron/sync-notifications`, never inside a transaction, so there's no
// transaction to hold open, and awaiting is what guarantees the send is
// attempted before that Route Handler's response goes out (a serverless
// invocation can be frozen/killed right after the response is sent, which
// would otherwise silently drop an in-flight send that nothing kept alive).
//
// `excludeUserId`, when given, drops that user's own subscriptions from the
// fan-out — by product decision, the household member who just performed
// the action that triggered this notification shouldn't be pushed a
// notification about their own action. Triggers with no single actor (the
// lazy background syncs in notifications.ts) simply omit it.
//
// A subscription whose quiet hours (GAP-14) cover the current hour in its
// own stored time zone is skipped. That filter runs here, in JS, rather than
// in the `where` clause because "current local hour" differs per row and
// Postgres would need each zone's offset at query time — a household has a
// handful of subscriptions, so fetching then filtering is cheap. Skipping is
// deliberately silent and lossy: the Notification row that triggered this
// was already written by the caller, so the in-app bell still shows it when
// the user next opens the app; only the OS-level buzz is suppressed, and it
// isn't queued for later (a stale "eggs ran out" push at 07:00 is noise).
export async function sendPushToHousehold(
  householdId: string,
  payload: PushPayload,
  excludeUserId?: string,
): Promise<void> {
  await deliver(
    {
      user: { memberships: { some: { householdId } } },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    payload,
  );
}

// The narrower sibling for a notification meant for particular people rather
// than everyone — the put-away reminder goes to whoever ticked the rows
// (syncPutAwayReminders in src/lib/notifications.ts). Still scoped through
// the household's memberships, so a member who has since left never gets a
// push about a list that's no longer theirs, and still subject to every
// subscription's quiet hours via deliver(). Never throws.
export async function sendPushToHouseholdMembers(
  householdId: string,
  userIds: readonly string[],
  payload: PushPayload,
): Promise<void> {
  if (userIds.length === 0) return;
  await deliver(
    {
      userId: { in: [...userIds] },
      user: { memberships: { some: { householdId } } },
    },
    payload,
  );
}

async function deliver(where: Prisma.PushSubscriptionWhereInput, payload: PushPayload): Promise<void> {
  if (!configured) return;

  const found = await prisma.pushSubscription.findMany({ where });
  const now = new Date();
  const subscriptions = found.filter(
    (sub) => !isWithinQuietHours(sub.quietHoursStart, sub.quietHoursEnd, sub.timeZone, now),
  );
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        // SEC-3: without a timeout, one unreachable/slow push service (or an
        // endpoint that slipped through as something other than a push
        // service's own host) could hang this call indefinitely and, since
        // these run under Promise.all, hold up every other subscription's
        // send alongside it.
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { timeout: 10_000 },
        );
      } catch (error) {
        // 404/410 means the browser has expired/revoked this subscription
        // server-side — clean it up so we stop trying. Anything else (a
        // transient network error, a malformed payload) is just logged.
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error("Failed to send push notification:", error);
        }
      }
    }),
  );
}
