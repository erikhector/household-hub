// UX-109: how the "Add transaction" sheet orders and preselects categories.
// Pure so the rules are unit-tested; the sheet and the two budget pages only
// wire them up. No "use server": safe from Server and Client Components.

type CategoryType = "INCOME" | "EXPENSE" | "SAVINGS";

/** Expenses are what people log on a phone, so they come first; savings and
 * income follow. */
const TYPE_ORDER: CategoryType[] = ["EXPENSE", "SAVINGS", "INCOME"];

/** How many of the latest transactions the pages look at to find the recent
 * categories: enough to see several distinct ones even when one category
 * dominates. */
export const RECENT_CATEGORY_SAMPLE = 30;

/** The category ids of `rows` (newest first), each once, at most `limit`.
 * The pages pass the latest transactions ordered by when they were logged. */
export function recentCategoryIds(rows: { categoryId: string }[], limit = 5): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.categoryId);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/** The picker's groups, in display order: expenses, savings, income. Within
 * a group the recently used categories come first (most recent first), then
 * the rest in the order given (alphabetical from the pages' query). Empty
 * groups are left out. */
export function groupCategoriesForLogging<T extends { id: string; type: CategoryType }>(
  categories: T[],
  recentIds: string[],
): { type: CategoryType; categories: T[] }[] {
  const rank = new Map(recentIds.map((id, index) => [id, index]));
  return TYPE_ORDER.map((type) => {
    const inGroup = categories.filter((c) => c.type === type);
    const recent = inGroup
      .filter((c) => rank.has(c.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const rest = inGroup.filter((c) => !rank.has(c.id));
    return { type, categories: [...recent, ...rest] };
  }).filter((group) => group.categories.length > 0);
}

/** The category a new transaction starts on: the Transactions tab's filter
 * when one is active, else the last one used. Both must still be one of
 * `categories` (a deleted or foreign id is ignored); null when neither is. */
export function defaultLoggingCategoryId(
  categories: { id: string }[],
  filterId: string | null | undefined,
  recentIds: string[],
): string | null {
  const known = new Set(categories.map((c) => c.id));
  if (filterId && known.has(filterId)) return filterId;
  return recentIds.find((id) => known.has(id)) ?? null;
}
