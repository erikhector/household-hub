import { prisma } from "@/lib/prisma";

// The category name/lookup key the shopping-list → budget link (Wave 2,
// Task 8) uses via findOrCreateGroceriesCategory below — see
// REQUIREMENTS.md's "Budgeting" section for the documented contract.
//
// Callers that need the name read it off the returned category
// (`category.name`) rather than importing this constant.
const GROCERIES_CATEGORY_NAME = "Groceries";

/**
 * Find-or-create the household's "Groceries" expense category, mirroring
 * `findOrCreateInventoryItem` in `src/app/dashboard/shopping-list/actions.ts`
 * (case-insensitive name match scoped to the household; creates it if
 * missing). Used by the shopping-list → budget expense link.
 *
 * Lives in a plain server module, not in a `"use server"` actions file:
 * every export of a `"use server"` file is a client-callable endpoint, and
 * this trusts its `householdId` argument and performs no auth check of its
 * own — every caller must already have resolved that id from its own
 * `requireHousehold()` call (never pass a client-supplied household id
 * through to this function). `src/lib/use-server-exports.test.ts` keeps
 * such helpers from drifting back into a `"use server"` file.
 */
export async function findOrCreateGroceriesCategory(householdId: string) {
  const existing = await prisma.budgetCategory.findFirst({
    where: {
      householdId,
      type: "EXPENSE",
      name: { equals: GROCERIES_CATEGORY_NAME, mode: "insensitive" },
    },
  });
  if (existing) return existing;

  return prisma.budgetCategory.create({
    data: { householdId, name: GROCERIES_CATEGORY_NAME, type: "EXPENSE" },
  });
}
