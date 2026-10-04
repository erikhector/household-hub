// Client-side error reporting for the error boundaries (src/app/error.tsx,
// global-error.tsx). The SDK is imported dynamically (PERF-8): a static
// `import * as Sentry` would ship ~130 KB gzipped in the root bundle of
// every page. NEXT_PUBLIC_SENTRY_DSN is inlined at build time, so with it
// unset the import below is dead code and no Sentry chunk is emitted at
// all. captureException without a DSN would be a no-op anyway, so behaviour
// is unchanged.
export async function captureClientException(error: unknown): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error);
  } catch {
    // Reporting must never throw out of an error boundary (e.g. the chunk
    // failing to load while offline).
  }
}
