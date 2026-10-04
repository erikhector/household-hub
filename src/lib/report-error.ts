import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/logger";

/**
 * Reports a caught error the way every background path should: one redacted,
 * greppable `logger.error` line plus a Sentry event. A bare `console.error`
 * skips both the logger's secret redaction and Sentry, so a cron failure that
 * is caught (and answered with a 200/500) would otherwise never page anyone.
 *
 * `householdId`, when the failure belongs to one household, is attached as a
 * Sentry tag (searchable) and in the log meta. Never pass anything else
 * identifying; Sentry.captureException is a documented no-op without a prior
 * Sentry.init() (only when SENTRY_DSN is set), so this is safe unconditionally.
 */
export function reportError(
  message: string,
  error: unknown,
  context: { householdId?: string } = {},
): void {
  logger.error(message, { error, ...context });
  Sentry.captureException(error, {
    ...(context.householdId ? { tags: { householdId: context.householdId } } : {}),
    extra: { message },
  });
}
