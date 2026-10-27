import { logger } from "@/lib/logger";
import { reportError } from "@/lib/report-error";
import {
  findHouseholdIdsWithSyncCandidates,
  syncExpiringSoonNotifications,
  syncMealNotLoggedNotifications,
  syncPutAwayReminders,
  syncTonightsDinnerNudge,
} from "@/lib/notifications";
import { timingSafeStringEqual } from "@/lib/timing-safe-equal";

// Scheduled background sync for the lazy notification triggers (meal not
// logged, expiring soon, and the put-away reminder) — see
// src/lib/notifications.ts's top doc comment for the full picture. These used to run inline inside getActiveNotifications on
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

// PERF-13: an explicit execution budget instead of the platform default,
// which the old walk over every household would eventually outgrow. The run
// is now proportional to households that have something to sync, but a
// morning with many expiring items still awaits one push per alert, so give
// it room. 60 s matches the other long-running routes here
// (inventory/page.tsx).
export const maxDuration = 60;

// Caps how many households sync concurrently. Every household's sync
// (syncMealNotLoggedNotifications + syncExpiringSoonNotifications) makes its
// own Prisma queries, so processing every household in one all-at-once
// Promise.all would make concurrency scale directly with household count —
// that exhausts the Prisma connection pool (and this route's own execution
// time budget on a serverless platform) long before household count is
// actually a scale problem worth worrying about. Batching bounds concurrent
// in-flight households to this number regardless of how many the household
// table holds.
const BATCH_SIZE = 10;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  // Reject unless CRON_SECRET is actually configured AND the header matches
  // it exactly — an unset secret must never be treated as "no auth required".
  // The match itself is constant-time (see timing-safe-equal.ts): a plain
  // `!==` here would let an attacker recover CRON_SECRET byte-by-byte from
  // response timing.
  //
  // Operational note: if CRON_SECRET is missing or wrong in the deploy
  // environment, EVERY invocation of this route 401s and the
  // meal-not-logged/expiring-soon notification triggers silently stop
  // firing entirely — nothing else surfaces that failure to a user. See
  // DEPLOYMENT.md's "Scheduled jobs" section, which calls out setting this
  // variable before merge as a hard deploy prerequisite,
  // not an optional follow-up.
  if (!secret || !authHeader || !timingSafeStringEqual(authHeader, `Bearer ${secret}`)) {
    logger.error("Notification sync cron rejected: missing or incorrect CRON_SECRET bearer token");
    return Response.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    // Only households with something the syncs could act on (one query per
    // trigger, see findHouseholdIdsWithSyncCandidates), not every household
    // in the table: the run's cost follows the work, not the signup count.
    const householdIds = await findHouseholdIdsWithSyncCandidates();
    const households = householdIds.map((id) => ({ id }));

    // Promise.allSettled, not Promise.all: one household's sync throwing
    // (e.g. a transient DB error, a push provider error) must not abort
    // every other household still in flight in the same batch, and must not
    // turn an otherwise-successful run into a 500 for everyone. Each
    // household's own outcome is inspected below — a per-household failure
    // is logged and counted, never rethrown — and batches run one after
    // another (not all at once) to bound concurrency; see BATCH_SIZE above.
    let succeeded = 0;
    const failedHouseholdIds: string[] = [];

    for (let i = 0; i < households.length; i += BATCH_SIZE) {
      const batch = households.slice(i, i + BATCH_SIZE);
      // allSettled *within* each household too, not Promise.all: with
      // Promise.all, a rejected meal sync would settle the household as
      // failed while its expiring-soon sync (and the push sends it awaits)
      // was still running — the batch loop would move on, and the last
      // batch's leftovers could still be in flight when the route responds
      // and the invocation gets frozen. Waiting for both also means a
      // failing meal sync never costs that household its expiry alerts.
      const results = await Promise.all(
        batch.map((household) =>
          Promise.allSettled([
            syncMealNotLoggedNotifications(household.id),
            syncExpiringSoonNotifications(household.id),
            syncPutAwayReminders(household.id),
            syncTonightsDinnerNudge(household.id),
          ]),
        ),
      );

      results.forEach((householdResults, index) => {
        const errors = householdResults.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
        if (errors.length === 0) {
          succeeded += 1;
          return;
        }
        const householdId = batch[index].id;
        // Logged with the household id for diagnosis, but that id (not the
        // raw error, which could carry connection-string-shaped internals —
        // see /api/health's matching principle) is all that goes back in
        // the response body below.
        for (const error of errors) {
          reportError("Notification sync failed for household", error, { householdId });
        }
        failedHouseholdIds.push(householdId);
      });
    }

    // The number to watch against maxDuration above; logged on every
    // authorised run so a creeping run time shows before it becomes a timeout.
    logger.info("Notification sync cron finished", {
      durationMs: Date.now() - startedAt,
      householdsWithCandidates: households.length,
      householdsSynced: succeeded,
      householdsFailed: failedHouseholdIds.length,
    });

    return Response.json(
      {
        status: failedHouseholdIds.length > 0 ? "partial_failure" : "ok",
        householdsSynced: succeeded,
        householdsFailed: failedHouseholdIds.length,
        failedHouseholdIds,
      },
      { status: 200 },
    );
  } catch (error) {
    // Reached only for a failure outside any single household's sync (e.g.
    // the candidate lookup itself failing) — same principle as /api/health:
    // log the real error server-side, don't leak internals in the response.
    reportError("Notification sync cron failed", error);

    return Response.json({ status: "error" }, { status: 500 });
  }
}
