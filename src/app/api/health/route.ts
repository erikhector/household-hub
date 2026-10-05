import { prisma } from "@/lib/prisma";
import { reportError } from "@/lib/report-error";

// Unauthenticated liveness/readiness probe for uptime monitors (UptimeRobot,
// Better Uptime, a host's built-in health check, etc.) — see DEPLOYMENT.md's
// "Monitoring" section. Deliberately has no session/auth check: infra hits
// this over plain HTTP, not a logged-in browser.
//
// Never cache this response — a stale 200 would mask a real outage.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Trivial round-trip that only succeeds if the DB is actually reachable
    // (not just that the Node process is up).
    await prisma.$queryRaw`SELECT 1`;

    return Response.json({ status: "ok", timestamp: new Date().toISOString() }, { status: 200 });
  } catch (error) {
    // Log the real error server-side for diagnosis, but don't leak internals
    // (connection strings, stack traces, etc.) in the response body — this
    // route is unauthenticated, same principle as toFriendlyError in
    // src/lib/actions/errors.ts.
    reportError("Health check failed", error);

    return Response.json({ status: "error" }, { status: 503 });
  }
}
