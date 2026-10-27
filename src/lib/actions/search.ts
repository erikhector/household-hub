"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  SEARCH_GROUP_LIMIT,
  SEARCH_MAX_CHARS,
  SEARCH_MIN_CHARS,
  searchHref,
  type SearchGroup,
  type SearchResult,
} from "@/lib/household-search";

// UX-41b: the command palette's household search. Read-only, so no
// revalidation. The household comes from the session and the client sends
// only the text; every query below is scoped by it.
//
// Rate limited because the palette fires a (debounced) request as you type:
// 120 a minute is far above a person typing and far below a script.
const SEARCH_RATE_LIMIT = 120;
const SEARCH_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const querySchema = z.string().trim().min(SEARCH_MIN_CHARS).max(SEARCH_MAX_CHARS);

export async function searchHouseholdAction(query: string): Promise<SearchResult> {
  const { household, userId } = await requireHousehold();

  // A too-short, too-long or non-string query (a forged call) is an empty
  // search, not an error to surface.
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return { ok: true, groups: [] };
  const q = parsed.data;

  if (!(await checkRateLimit(`search:${userId}`, SEARCH_RATE_LIMIT, SEARCH_RATE_LIMIT_WINDOW_MS))) {
    return { ok: false, rateLimited: true };
  }

  const householdId = household.id;
  const take = SEARCH_GROUP_LIMIT;
  const contains = { contains: q, mode: "insensitive" as const };
  const select = { id: true, name: true };

  const [inventory, recipes, shoppingLists, tasks, categories] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { householdId, name: contains }, select, orderBy: { name: "asc" }, take }),
    prisma.recipe.findMany({ where: { householdId, name: contains }, select, orderBy: { name: "asc" }, take }),
    prisma.shoppingList.findMany({
      where: { householdId, archivedAt: null, name: contains },
      select,
      orderBy: { name: "asc" },
      take,
    }),
    prisma.householdTask.findMany({
      where: { householdId, title: contains },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
      take,
    }),
    prisma.budgetCategory.findMany({ where: { householdId, name: contains }, select, orderBy: { name: "asc" }, take }),
  ]);

  const groups: SearchGroup[] = [
    { key: "inventory", hits: inventory.map((r) => ({ ...r, href: searchHref.inventory(r.id) })) },
    { key: "recipes", hits: recipes.map((r) => ({ ...r, href: searchHref.recipes(r.id) })) },
    { key: "shoppingLists", hits: shoppingLists.map((r) => ({ ...r, href: searchHref.shoppingLists(r.id) })) },
    { key: "tasks", hits: tasks.map((r) => ({ id: r.id, name: r.title, href: searchHref.tasks() })) },
    { key: "budgetCategories", hits: categories.map((r) => ({ ...r, href: searchHref.budgetCategories(r.id) })) },
  ];
  return { ok: true, groups: groups.filter((group) => group.hits.length > 0) };
}
