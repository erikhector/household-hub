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

// SEC-3: the endpoint is whatever the browser's Push API handed back, and
// sendPushToHousehold (src/lib/push.ts) later POSTs to it verbatim — with no
// allowlist, a tampered client could park an internal URL here and turn
// every notification fan-out into a blind SSRF probe of this server's own
// network. These are the real push services' delivery hosts as of today;
// matched by suffix (`endsWith(".host")` after an exact-match check), never
// by substring, so "fcm.googleapis.com.evil.example" doesn't qualify.
const PUSH_ENDPOINT_HOST_ALLOWLIST = [
  // Chrome has been observed handing out endpoints on more than one Google
  // host — the documented `fcm.googleapis.com/fcm/send/...`, but also
  // `jmtNN.google.com/fcm/send/...` (`jmt17`, seen in the wild; the number
  // isn't documented as fixed, so a regex on just that one shape would be
  // one Chrome release away from breaking again). Both are Google's own
  // public multi-tenant edge, not internal infrastructure, so allowlisting
  // the whole of google.com carries none of the SSRF risk this list exists
  // to block (that risk is reaching *this server's own network*, not
  // reaching more of Google) — it's just broader than the other three
  // entries because Google doesn't publish a fixed delivery host the way
  // Mozilla/Microsoft/Apple do.
  "googleapis.com", // fcm.googleapis.com — the documented Chrome/Edge host
  "google.com", // a *different* domain than googleapis.com (not a subdomain
  // of it), needed separately for the jmtNN.google.com hosts above
  "push.services.mozilla.com", // Firefox (covers updates.push.services.mozilla.com)
  "notify.windows.com", // legacy Edge/WNS
  "push.apple.com", // Safari on macOS/iOS 16.4+ (covers web.push.apple.com)
] as const;

function isAllowedPushHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return PUSH_ENDPOINT_HOST_ALLOWLIST.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// Decodes a base64url string (padding tolerated, since some browsers still
// send `=`-padded keys even though the Push API spec calls for unpadded) and
// returns its byte length, or null if it isn't valid base64url at all. Used
// below to check each ECDH/auth key is exactly the size the Web Push
// protocol defines, rather than just "some string" that gets forwarded to
// web-push and, from there, to the (now-allowlisted, but still
// third-party) push service.
function base64UrlByteLength(value: string): number | null {
  const stripped = value.replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]+$/.test(stripped)) return null;
  return Buffer.from(stripped, "base64url").length;
}

const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(1024)
    .refine((value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return url.protocol === "https:" && isAllowedPushHost(url.hostname);
    }, "Endpoint must be an https URL on a recognised push service"),
  keys: z.object({
    // 65-byte uncompressed P-256 point -> 87 base64url characters unpadded.
    p256dh: z
      .string()
      .max(128)
      .refine((value) => base64UrlByteLength(value) === 65, "p256dh must decode to 65 bytes"),
    // 16-byte auth secret -> 22 base64url characters unpadded.
    auth: z
      .string()
      .max(64)
      .refine((value) => base64UrlByteLength(value) === 16, "auth must decode to 16 bytes"),
  }),
  timeZone: z.string().optional(),
});

// SEC-3: caps rows per user so a PWA that gets reinstalled often (each
// install/permission-reset is a brand-new endpoint) can't grow this table
// without bound — sendPushToHousehold fetches every row for a household on
// every notification, so an unbounded count slows down every fan-out, not
// just that one user's.
const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

// Called from push-notifications-card.tsx right after
// `pushManager.subscribe()` resolves. Upserts by endpoint so re-subscribing
// the same browser (e.g. after clearing its permission) just refreshes the
// keys instead of erroring on the unique constraint.
export async function subscribeToPushAction(sub: PushSubscriptionInput): Promise<void> {
  const userId = await requireUserId();

  const parsed = pushSubscriptionSchema.safeParse(sub);
  if (!parsed.success) {
    // A real browser's Push API never produces an endpoint or keys that
    // fail this schema — this can only be a tampered client or a push
    // service outside the allowlist, and there's no form here to show a
    // field error on. Throwing surfaces it to the card's existing
    // catch/setError(true) path, same as a rejected pushManager.subscribe().
    throw new Error("Invalid push subscription");
  }
  const { endpoint, keys, timeZone: rawTimeZone } = parsed.data;
  const timeZone = sanitizeTimeZone(rawTimeZone);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.pushSubscription.findUnique({ where: { endpoint }, select: { id: true } });
    if (!existing) {
      // Only enforce the cap when this endpoint would add a new row — an
      // update to an already-stored endpoint (the common "resubscribe the
      // same browser" case) never grows the count, so it should never evict
      // anything.
      const count = await tx.pushSubscription.count({ where: { userId } });
      if (count >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
        // Evict the oldest row rather than reject the new subscribe: a user
        // hitting the cap is almost always someone who reinstalls the PWA a
        // lot (a new service-worker registration each time is a new
        // endpoint), and the oldest row is the one most likely already dead
        // — rejecting would just leave them unable to get push on the
        // device in front of them right now.
        const oldest = await tx.pushSubscription.findFirst({
          where: { userId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (oldest) await tx.pushSubscription.delete({ where: { id: oldest.id } });
      }
    }

    await tx.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, timeZone },
      // Quiet hours are left alone on update — re-subscribing refreshes keys
      // and the zone, it isn't a request to reset the user's schedule.
      update: { userId, p256dh: keys.p256dh, auth: keys.auth, timeZone },
    });
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
