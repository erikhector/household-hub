// URL state for the two budget pages (household and personal), which share
// one tab shell (src/components/budget/budget-tabs.tsx). No "use server",
// safe from Server and Client Components alike.
//
// The open tab and the transaction list's category filter live in the
// query string next to `?month=` (and the household page's `?household=`
// override), so paging months, a reload or a link from Insights all land
// on the same view. Before this, the tab was client state and every month
// link dropped it, bouncing someone paging back through Transactions to
// Overview on every tap.

export const BUDGET_TABS = ["overview", "manage", "transactions", "insights"] as const;
export type BudgetTab = (typeof BUDGET_TABS)[number];

/** `?tab=` → a known tab, or Overview (the landing tab) for anything else. */
export function parseBudgetTab(value: string | string[] | null | undefined): BudgetTab {
  const first = Array.isArray(value) ? value[0] : value;
  return BUDGET_TABS.find((tab) => tab === first) ?? "overview";
}

/** A budget page URL. Keys always come out in the same order so links
 * compare equal; an empty or missing value is left out, and so is the
 * default Overview tab. */
export function budgetHref(
  basePath: string,
  params: { month?: string; household?: string; tab?: BudgetTab; category?: string },
): string {
  const query = new URLSearchParams();
  if (params.month) query.set("month", params.month);
  if (params.household) query.set("household", params.household);
  if (params.tab && params.tab !== "overview") query.set("tab", params.tab);
  if (params.category) query.set("category", params.category);
  const search = query.toString().replaceAll("+", "%20");
  return search ? `${basePath}?${search}` : basePath;
}
