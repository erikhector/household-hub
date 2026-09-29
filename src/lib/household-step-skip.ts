import { cookies } from "next/headers";

// Cookie for the getting-started household step's "skip it" choice (see
// skipHouseholdStepAction in src/lib/actions/household.ts, which sets it).
// Suffixed with the household's id; listed in src/lib/cookie-inventory.ts.
export const HOUSEHOLD_STEP_SKIP_COOKIE_PREFIX = "household_step_skipped_";

/**
 * Whether this browser dismissed the household step for `householdId`.
 *
 * Lives in a plain server module, not in the `"use server"` household
 * actions file, because it takes a household id and does no auth check:
 * exported from a `"use server"` file it would be a client-callable
 * endpoint. Callers pass the id from their own `requireHousehold()`.
 */
export async function isHouseholdStepSkipped(householdId: string): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(`${HOUSEHOLD_STEP_SKIP_COOKIE_PREFIX}${householdId}`)?.value === "1";
}
