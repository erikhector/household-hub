import * as Sentry from "@sentry/nextjs";
import type { ZodError } from "zod";
import type { ActionState } from "@/lib/actions/auth";
import { en } from "@/lib/i18n/dictionaries/en";
import { format } from "@/lib/i18n/format";
import { logger } from "@/lib/logger";

/** A key of `dict.errors`, the server-action messages in both languages. */
export type ErrorKey = keyof typeof en.errors;

/**
 * Marks a string as an `errors` key inside a Zod schema
 * (`.min(1, v("nameRequired"))`). Schemas are module-level constants, so they
 * can't know the request's language; the action resolves the key with
 * `zodFail()` instead. A typo is a compile error here rather than an
 * untranslated message in production.
 */
export function v(key: ErrorKey): string {
  return key;
}

/**
 * The message for `key` in the request's language. Falls back to English when
 * the dictionary can't be read (no request context, or a unit test that
 * stubs getDictionary partially) so a failure path never throws a second
 * error on top of the first.
 */
export async function errorText(
  key: ErrorKey,
  vars?: Record<string, string | number>,
): Promise<string> {
  let template: string = en.errors[key];
  try {
    // Imported on demand: get-dictionary is `server-only` and reads the
    // request's cookies, so a module that merely imports errors.ts (a pure
    // calculator's test, say) must not need either to load.
    const { getDictionary } = await import("@/lib/i18n/get-dictionary");
    template = (await getDictionary()).errors[key] ?? template;
  } catch {
    // keep the English fallback
  }
  return vars ? format(template, vars) : template;
}

/** `{ error }` in the request's language, for `return await fail("itemNotFound")`. */
export async function fail(
  key: ErrorKey,
  vars?: Record<string, string | number>,
): Promise<{ error: string }> {
  return { error: await errorText(key, vars) };
}

/**
 * The first Zod issue as a translated `{ error }`. An issue whose message is
 * an `errors` key (see `v()`) is translated; anything else (Zod's own default
 * text, a schema not moved over yet) becomes `fallback` rather than leaking
 * English to a Swedish user.
 */
export async function zodFail(
  error: ZodError,
  fallback: ErrorKey = "invalidInput",
): Promise<{ error: string }> {
  const message = error.issues[0]?.message;
  const key = message !== undefined && message in en.errors ? (message as ErrorKey) : fallback;
  return fail(key);
}

/**
 * Converts an unexpected error (DB failure, network blip, etc. — anything
 * that wasn't already turned into a validation `{ error }` by zod) into a
 * generic, friendly ActionState. Logs the real error server-side and
 * reports it to Sentry so it's still diagnosable, without leaking internals
 * to the client. The message is in the request's language.
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
export async function toFriendlyError(error: unknown): Promise<ActionState> {
  logger.error("Unexpected error in server action", { error });
  Sentry.captureException(error);
  return fail("generic");
}
