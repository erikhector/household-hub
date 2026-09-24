import { prisma } from "@/lib/prisma";
import { syncExpiringSoonNotifications, syncMealNotLoggedNotifications } from "@/lib/notifications";

// Scheduled background sync for the two lazy notification triggers (meal not
// logged, expiring soon) — see src/lib/notifications.ts's top doc comment for
// the full picture. These used to run inline inside getActiveNotifications on
// every bell fetch; that meant opening the bell could trigger an unbounded
// number of Notification writes and push sends on what should've been a pure
// read. This route is the replacement: something external (a Vercel cron, a
// Railway/Render scheduled job — see DEPLOYMENT.md's "Scheduled jobs"
// section) hits it on an interval instead, and getActiveNotifications is now
// read-only.
//
// Unlike /api/health, this route both writes data (Notification rows) and
// sends push notifications to every subscribed device in every household, so
// it must never be publicly callable. Protected with a shared secret rather
// than a session cookie since the caller is infrastructure, not a logged-in
// browser — the same reasoning as most "cron secret" conventions (Vercel's
// own cron feature sends exactly this header/value shape when CRON_SECRET is
// set in the project's environment, so no extra wiring is needed there
// beyond setting the env var; see DEPLOYMENT.md).
//
// Never cache this response — same reasoning as /api/health's matching
// comment, though the risk here is stale success/failure status rather than
// a masked outage.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  // Reject unless CRON_SECRET is actually configured AND the header matches
  // it exactly — an unset secret must never be treated as "no auth required".
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  try {
    const households = await prisma.household.findMany({ select: { id: true } });

    // Independent per household — one household's sync failing (e.g. a bad
    // push subscription) shouldn't block the rest from running. Both sync
    // functions already swallow their own expected races (see their doc
    // comments in src/lib/notifications.ts); Promise.all here is about
    // running households concurrently, not suppressing errors.
    await Promise.all(
      households.map((household) =>
        Promise.all([syncMealNotLoggedNotifications(household.id), syncExpiringSoonNotifications(household.id)]),
      ),
    );

    return Response.json({ status: "ok", householdsSynced: households.length }, { status: 200 });
  } catch (error) {
    // Same principle as /api/health: log the real error server-side, don't
    // leak internals in the response body of what is, from the outside,
    // still an unauthenticated-looking endpoint (bearer token aside).
    console.error("Notification sync cron failed:", error);

    return Response.json({ status: "error" }, { status: 500 });
  }
}
