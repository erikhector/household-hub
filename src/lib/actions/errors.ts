import type { ActionState } from "@/lib/actions/auth";

/**
 * Converts an unexpected error (DB failure, network blip, etc. — anything
 * that wasn't already turned into a validation `{ error }` by zod) into a
 * generic, friendly ActionState. Logs the real error server-side so it's
 * still diagnosable, without leaking internals to the client.
 *
 * Never wrap a call to `redirect()`/`notFound()` in the same try/catch this
 * feeds — both throw a special Next.js error that must propagate
 * unchanged. Wrap only the risky `prisma.*`/`fetch` call itself, and let
 * `revalidatePath`/`redirect` run outside the try block.
 */
export function toFriendlyError(error: unknown): ActionState {
  console.error(error);
  return { error: "Something went wrong. Please try again." };
}
