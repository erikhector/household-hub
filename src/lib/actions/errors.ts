import * as Sentry from "@sentry/nextjs";
import type { ActionState } from "@/lib/actions/auth";
import { logger } from "@/lib/logger";

/**
 * Converts an unexpected error (DB failure, network blip, etc. — anything
 * that wasn't already turned into a validation `{ error }` by zod) into a
 * generic, friendly ActionState. Logs the real error server-side and
 * reports it to Sentry so it's still diagnosable, without leaking internals
 * to the client.
 *
 * Sentry.captureException is a documented no-op without a prior
 * Sentry.init() call, which only happens when SENTRY_DSN is set (see
 * src/instrumentation.ts) — safe to call unconditionally here.
 *
 * Never wrap a call to `redirect()`/`notFound()` in the same try/catch this
 * feeds — both throw a special Next.js error that must propagate
 * unchanged. Wrap only the risky `prisma.*`/`fetch` call itself, and let
 * `revalidatePath`/`redirect` run outside the try block.
 */
export function toFriendlyError(error: unknown): ActionState {
  logger.error("Unexpected error in server action", { error });
  Sentry.captureException(error);
  return { error: "Something went wrong. Please try again." };
}
