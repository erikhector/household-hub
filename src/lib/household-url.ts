// URL state for the Household page's tabs (UX-174). No "use server", safe
// from Server and Client Components alike.
//
// The page was ~3 000 CSS px of stacked cards on a phone, so it is split
// into Members (people and invites, the landing tab), Notes (the shared
// board) and Settings (every preference, plus the danger zone). The open
// tab lives in `?tab=` so a reload, a back navigation and a link from
// elsewhere (the danger zone's "Go to the members") land on the same view.

export const HOUSEHOLD_TABS = ["members", "notes", "settings"] as const;
export type HouseholdTab = (typeof HOUSEHOLD_TABS)[number];

/** `?tab=` → a known tab, or Members (the landing tab) for anything else. */
export function parseHouseholdTab(value: string | string[] | null | undefined): HouseholdTab {
  const first = Array.isArray(value) ? value[0] : value;
  return HOUSEHOLD_TABS.find((tab) => tab === first) ?? "members";
}

/** The Household page URL for a tab; Members is the default, so it has no query. */
export function householdHref(tab: HouseholdTab = "members"): string {
  return tab === "members" ? "/dashboard/household" : `/dashboard/household?tab=${tab}`;
}
