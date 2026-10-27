import { budgetHref } from "@/lib/budget-url";

// UX-41b: the shapes and links behind the command palette's household
// search. Plain data and pure functions, no Prisma, so the palette (a Client
// Component) can import the types and constants while the Server Action in
// src/lib/actions/search.ts does the querying.

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 80;
/** Rows per group: the palette is a jump list, not a results page. */
export const SEARCH_GROUP_LIMIT = 5;

export const SEARCH_GROUPS = ["inventory", "recipes", "shoppingLists", "tasks", "budgetCategories"] as const;
export type SearchGroupKey = (typeof SEARCH_GROUPS)[number];

export type SearchHit = { id: string; name: string; href: string };
export type SearchGroup = { key: SearchGroupKey; hits: SearchHit[] };
export type SearchResult = { ok: true; groups: SearchGroup[] } | { ok: false; rateLimited: true };

// Where a hit opens. Inventory items and shopping lists have their own page.
// A recipe opens the Recipes tab searched down to it (MATCH-6's link). A
// budget category opens Transactions filtered to it. Tasks have no page of
// their own, so they land on the task list.
export const searchHref = {
  inventory: (id: string) => `/dashboard/inventory/items/${id}`,
  recipes: (id: string) => `/dashboard/meal-planning?tab=recipes&recipe=${encodeURIComponent(id)}`,
  shoppingLists: (id: string) => `/dashboard/shopping-list/${id}`,
  tasks: () => "/dashboard/tasks",
  budgetCategories: (id: string) => budgetHref("/dashboard/budget", { tab: "transactions", category: id }),
} as const;
