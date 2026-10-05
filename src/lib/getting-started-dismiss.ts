import { cookies } from "next/headers";

// Cookie for hiding the whole "Get set up" card on the overview (UX-26; see
// dismissGettingStartedAction in src/lib/actions/household.ts, which sets
// it). Suffixed with the household's id like HOUSEHOLD_STEP_SKIP_COOKIE_PREFIX
// in src/lib/household-step-skip.ts, and for the same reason: most steps are
// about the household's data, so hiding the nudge for a household you know
// well shouldn't hide it for a new one you've just joined or created.
// Listed in src/lib/cookie-inventory.ts.
export const GETTING_STARTED_DISMISS_COOKIE_PREFIX = "getting_started_dismissed_";

/**
 * Whether this browser hid the getting-started card for `householdId`.
 *
 * A plain server module, not part of the `"use server"` household actions
 * file, for the reason given on isHouseholdStepSkipped: it takes a household
 * id and does no auth check, so it must not become a client-callable
 * endpoint. Callers pass the id from their own `requireHousehold()`.
 */
export async function isGettingStartedDismissed(householdId: string): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(`${GETTING_STARTED_DISMISS_COOKIE_PREFIX}${householdId}`)?.value === "1";
}
