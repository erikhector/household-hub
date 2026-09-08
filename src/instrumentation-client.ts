import * as Sentry from "@sentry/nextjs";

// Browser-side counterpart to src/instrumentation.ts, using the file
// convention Next.js 16 uses in place of the older sentry.client.config.ts
// (see node_modules/next/dist/docs/.../instrumentation-client.md --
// @sentry/nextjs 10.x itself warns when it finds a sentry.client.config.ts
// and recommends this file instead). Runs after the HTML loads and before
// React hydrates.
//
// Needs NEXT_PUBLIC_SENTRY_DSN rather than SENTRY_DSN: only
// NEXT_PUBLIC_-prefixed env vars are inlined into the client bundle, so a
// plain SENTRY_DSN read here would always be undefined in the browser.
// Optional like the server side -- unset by default, so local dev/CI ship
// no client-side Sentry initialization or network calls to a Sentry ingest
// endpoint.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0,
  });
}

// Required export for App Router navigation instrumentation (breadcrumbs
// for route changes) -- safe to export unconditionally: it's a no-op until
// Sentry.init() has registered its router-transition handler above, which
// only happens when NEXT_PUBLIC_SENTRY_DSN is set.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
