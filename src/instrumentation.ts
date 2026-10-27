import * as Sentry from "@sentry/nextjs";
import { sentryDataCollection } from "@/lib/sentry-options";

// Next.js calls `register()` once per server instance (Node and Edge each
// get their own call, distinguished by NEXT_RUNTIME) before it starts
// handling requests -- see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md.
// This is the current (Next 15+/16) convention: there's no more
// sentry.server.config.ts/sentry.edge.config.ts auto-loaded by webpack
// magic, this file drives it explicitly.
//
// Fully optional, mirroring src/lib/email.ts's
// `resend = RESEND_API_KEY ? new Resend(...) : null` pattern: with
// SENTRY_DSN unset (the default for local dev and CI), Sentry.init() is
// simply never called, so there's no network call, no background
// transport, nothing. `onRequestError` below stays exported unconditionally
// because it's safe to do so -- see its own comment.
export async function register() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // This task wires up error reporting, not performance monitoring/
    // tracing. Leave sampling at 0 so enabling Sentry doesn't also start
    // shipping trace data; a human can raise this later in Sentry project
    // settings once there's real traffic to justify it.
    tracesSampleRate: 0,
    // v11 collects user info, cookies and bodies unless told otherwise.
    dataCollection: sentryDataCollection,
  });
}

// Reports errors Next's own request lifecycle catches before a response is
// sent -- from Server Components, Route Handlers, Server Actions, and the
// proxy (src/proxy.ts) -- i.e. genuinely unhandled server-side errors, as
// opposed to the ones src/lib/actions/errors.ts already turns into a
// friendly `{ error }` ActionState.
//
// Safe to export unconditionally even with no SENTRY_DSN: without a prior
// Sentry.init() call, the underlying Sentry.captureException is a
// documented no-op (`getCurrentScope().captureException` just returns early
// when no client is configured -- see @sentry/core's scope.js) rather than
// a network call, error, or warning outside a debug build.
export const onRequestError = Sentry.captureRequestError;
