import { auth } from "@/lib/auth";

// TEMPORARY: a deliberate crash for checking the Sentry pipeline end to end
// on the real deployment (DSN set in Vercel → error reaches Sentry → the
// production autopilot scout turns it into a BUG- backlog item). Remove
// this route once that has been seen working.
//
// The throw is unhandled on purpose: it must travel the same path as a real
// bug, through Next's request lifecycle into `onRequestError` in
// src/instrumentation.ts, rather than a manual Sentry.captureException that
// would pass even if that wiring were broken.
//
// Signed-in users only. /api/* is outside src/proxy.ts's matcher, so without
// this check anyone could hit it in a loop and burn the Sentry event quota.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  throw new Error("Squirrel Sentry pipeline test - safe to resolve");
}
