// Sends real device/OS push notifications on top of the in-app bell (see
// src/lib/notifications.ts's doc comment for the notification center this
// extends). Subscriptions are stored per-user by src/lib/actions/push.ts;
// service worker at src/lib/service-worker.js is what actually shows the
// notification and handles a click.

import webpush from "web-push";
import { prisma } from "@/lib/prisma";

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
// household's members. Never throws: callers (recordOutOfStockTransition,
// syncMealNotLoggedNotifications in src/lib/notifications.ts) fire this
// without awaiting it, since some of their call sites run inside a Prisma
// $transaction and awaiting a network call there would hold the transaction
// open. Push delivery has no guarantee from the Push API itself either way,
// so losing a send if the surrounding write later rolls back is an
// acceptable trade for not blocking on network I/O mid-transaction.
export async function sendPushToHousehold(householdId: string, payload: PushPayload): Promise<void> {
  if (!configured) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { user: { memberships: { some: { householdId } } } },
  });
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
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
