// UX-112: what a member with shared household splits sees before they've set
// up a personal budget (no categories, so no Safe to spend). Pure: the loader
// (personal-budget-position.ts) already did the hard part, this only decides
// whether there is anything to show and sums this month's share.

import type { HouseholdDebt } from "@/lib/safe-to-spend-calc";

export type SharedCostsSummary = {
  /** The user's own share of this month's split expenses (never the whole
   * bill, never income or savings). */
  monthShare: number;
  /** True when there is a share or a balance to show at all. */
  hasAny: boolean;
};

export function summarizeSharedCosts(
  sharedPostedRows: { amount: number; type: "INCOME" | "EXPENSE" | "SAVINGS" }[],
  householdDebts: HouseholdDebt[],
): SharedCostsSummary {
  const monthShare = sharedPostedRows.reduce((sum, r) => (r.type === "EXPENSE" ? sum + r.amount : sum), 0);
  return {
    monthShare,
    hasAny: sharedPostedRows.length > 0 || householdDebts.length > 0,
  };
}
