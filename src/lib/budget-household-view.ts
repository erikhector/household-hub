// Resolves which household /dashboard/budget should show, and whether that
// view is writable, from the page's `?household=` search param.
//
// The param comes from "View in {household} Budget" links on shared rows in
// Personal Budget (F1). They point at the bill's *actual* household, which
// may not be the "active" one in the session cookie once a user belongs to
// more than one. The page reads that household's data, but every budget
// Server Action scopes its writes to `requireHousehold()`'s *active*
// household (AGENTS.md's tenancy rule). So a non-active household is shown
// read-only, with a one-click switch, instead of offering "Add transaction"
// and friends that would write to (or fail to find rows in) a different
// household than the one on screen.
//
// Kept pure, separate from page.tsx, so the membership check and read-only
// decision can be unit-tested without rendering the page.

export type BudgetHouseholdView = {
  /** The household whose data the page reads. */
  householdId: string;
  /** The validated `?household=` value to keep on month-navigation links,
   * or undefined when there was none (or it wasn't trusted). */
  householdParam: string | undefined;
  /** True when the page shows a household other than the active one. Its
   * write controls are disabled because the actions would target the
   * active household instead. */
  readOnly: boolean;
};

export function resolveBudgetHouseholdView({
  param,
  activeHouseholdId,
  memberHouseholdIds,
}: {
  /** Raw `searchParams.household`. It's client-supplied, so it's only
   * trusted when it names a household the signed-in user belongs to. */
  param: string | string[] | undefined;
  activeHouseholdId: string;
  /** Every household the signed-in user is a member of, from
   * requireHousehold()'s `households`. */
  memberHouseholdIds: string[];
}): BudgetHouseholdView {
  const value = Array.isArray(param) ? param[0] : param;
  // Anything that isn't one of the user's own households is ignored rather
  // than erroring, the same graceful-fallback convention `?month=` uses.
  const explicitId = value && memberHouseholdIds.includes(value) ? value : undefined;
  const householdId = explicitId ?? activeHouseholdId;
  return {
    householdId,
    householdParam: explicitId,
    readOnly: householdId !== activeHouseholdId,
  };
}
