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
//
// The SDK is loaded with a dynamic import() behind that check (PERF-8): a
// static import put ~130 KB gzipped of Sentry in the root bundle of every
// page, /login included, even with no DSN. NEXT_PUBLIC_SENTRY_DSN is
// inlined at build time, so with it unset the whole branch (and the import)
// is dead code and no Sentry chunk is emitted. The trade-off with a DSN
// set: the SDK loads async, so an error thrown in the first moments before
// the chunk arrives isn't captured.
import { SENTRY_DATA_COLLECTION } from "@/lib/sentry-data-collection";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0,
      // Sentry 11 collects personal data unless opted out per category.
      dataCollection: SENTRY_DATA_COLLECTION,
    });
  });
}

// Required export for App Router navigation instrumentation (breadcrumbs
// for route changes). Forwards to the lazily loaded SDK and stays a no-op
// without a DSN, where nothing was ever initialized to record it. If the
// SDK hasn't finished loading yet, the import() just resolves once it has.
export function onRouterTransitionStart(
  ...args: Parameters<typeof import("@sentry/nextjs").captureRouterTransitionStart>
) {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    void import("@sentry/nextjs").then((Sentry) =>
      Sentry.captureRouterTransitionStart(...args),
    );
  }
}
