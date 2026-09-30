import type { Prisma } from "@/generated/prisma/client";

// The category a household gets when it hasn't picked one: the name the
// shopping-list → budget link (Wave 2, Task 8) has always logged to — see
// REQUIREMENTS.md's "Budgeting" section for the documented contract.
//
// Callers that need the name read it off the returned category
// (`category.name`) rather than importing this constant, since a household
// may have renamed it or picked another category altogether.
const GROCERIES_CATEGORY_NAME = "Groceries";

/**
 * The expense category a completed shopping list (or a registered receipt)
 * logs its total to: the household's pick (Household.shoppingExpenseCategory,
 * set from the Household page), or else its "Groceries" expense category,
 * found case-insensitively or created. The fallback's id is then stored as
 * the household's pick, so later lookups go by id and a rename of that
 * category ("Groceries" → "Mat") no longer spawns a second "Groceries" on the
 * next trip.
 *
 * Takes the caller's transaction client so the lookup, the pin and the
 * expense it feeds all commit (or roll back) together with the completion
 * itself (MAINT-5).
 *
 * Lives in a plain server module, not in a `"use server"` actions file:
 * every export of a `"use server"` file is a client-callable endpoint, and
 * this trusts its `householdId` argument and performs no auth check of its
 * own — every caller must already have resolved that id from its own
 * `requireHousehold()` call (never pass a client-supplied household id
 * through to this function). `src/lib/use-server-exports.test.ts` keeps
 * such helpers from drifting back into a `"use server"` file.
 */
export async function resolveShoppingExpenseCategory(tx: Prisma.TransactionClient, householdId: string) {
  const household = await tx.household.findUnique({
    where: { id: householdId },
    select: { shoppingExpenseCategory: true },
  });
  const picked = household?.shoppingExpenseCategory;
  // The setting action already only stores this household's EXPENSE
  // categories; re-checked here because it's what keeps a shopping trip
  // from ever landing in income or savings (or, somehow, another household).
  if (picked && picked.householdId === householdId && picked.type === "EXPENSE") return picked;

  const category =
    (await tx.budgetCategory.findFirst({
      where: {
        householdId,
        type: "EXPENSE",
        name: { equals: GROCERIES_CATEGORY_NAME, mode: "insensitive" },
      },
    })) ??
    (await tx.budgetCategory.create({
      data: { householdId, name: GROCERIES_CATEGORY_NAME, type: "EXPENSE" },
    }));

  await tx.household.update({
    where: { id: householdId },
    data: { shoppingExpenseCategoryId: category.id },
  });
  return category;
}
