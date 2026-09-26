import { isEmailConfigured } from "@/lib/email";
import { timingSafeStringEqual } from "@/lib/timing-safe-equal";
import { runWeeklyDigest } from "@/lib/weekly-digest";

// GAP-27: sends the opt-in weekly household digest email. Same shape and
// protection as /api/cron/sync-notifications (read that route's comments for
// the full reasoning): triggered by an external scheduler — `vercel.json`'s
// weekly cron on Vercel, or the platform's own scheduler elsewhere (see
// DEPLOYMENT.md's "Scheduled jobs" section) — and guarded by the same
// CRON_SECRET bearer token, since it reads every opted-in household's data
// and sends email on its behalf.
//
// Safe to call more than once in a week: WeeklyDigestSend (see
// src/lib/weekly-digest.ts's sendHouseholdDigest) makes a repeat run a no-op
// for everyone who already got this week's digest.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  // An unset secret must never be treated as "no auth required" — same rule
  // as the notification sync route. The match is constant-time (see
  // timing-safe-equal.ts) so a wrong guess can't be narrowed down from
  // response timing.
  if (!secret || !authHeader || !timingSafeStringEqual(authHeader, `Bearer ${secret}`)) {
    console.error("Weekly digest cron rejected: missing or incorrect CRON_SECRET bearer token");
    return Response.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }

  // Email is optional infrastructure in this app (see src/lib/email.ts): with
  // no RESEND_API_KEY the run is a successful no-op, not an error, and skips
  // every database read it would otherwise make for nothing.
  if (!isEmailConfigured()) {
    return Response.json({ status: "skipped", reason: "email_not_configured" }, { status: 200 });
  }

  // Signs each email's unsubscribe link (src/lib/digest-unsubscribe-token.ts).
  // Always set in a working deployment since Auth.js needs it too; without it
  // no email may go out, because every one must carry a working unsubscribe.
  const signingSecret = process.env.AUTH_SECRET;
  if (!signingSecret) {
    console.error("Weekly digest cron skipped: AUTH_SECRET is not set, so unsubscribe links can't be signed");
    return Response.json({ status: "skipped", reason: "auth_secret_missing" }, { status: 200 });
  }

  // APP_URL when configured (the same deployer-controlled base URL invite
  // and password-reset links use), otherwise the origin this request came in
  // on — for a Vercel cron that's the production deployment's own URL.
  const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, "") || new URL(request.url).origin;

  try {
    const result = await runWeeklyDigest({ now: new Date(), appUrl, secret: signingSecret });
    return Response.json(
      {
        status: result.failedHouseholdIds.length > 0 ? "partial_failure" : "ok",
        ...result,
      },
      { status: 200 },
    );
  } catch (error) {
    // Only reached when the household lookup itself fails; per-household
    // failures are counted inside runWeeklyDigest. Log the real error, keep
    // internals out of the response.
    console.error("Weekly digest cron failed:", error);
    return Response.json({ status: "error" }, { status: 500 });
  }
}
