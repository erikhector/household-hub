import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, insertHouseholdTransaction, withDb } from "./budget-seed";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-117: Safe to spend answers "how much can I spend today?" with a daily
// number, and the pace chart prints an amount on its Today and Month-end
// points instead of bare labels.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the card shows an amount per day for the days left, and the chart labels carry amounts", async ({ page }) => {
  const tag = budgetTag();
  await withDb(async (client) => {
    // An empty month first (only E2E_HOUSEHOLD's rows), then 3 100 in and
    // 100 of everyday spending: safe to spend is exactly 3 000.
    await client.query(`DELETE FROM "RecurringTemplate" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
    await client.query(`DELETE FROM "PlannedExpense" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
    await client.query(`DELETE FROM "Transaction" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
    // UX-138: a limit left behind by another spec would hold money back.
    await client.query(`UPDATE "BudgetCategory" SET "monthlyLimit" = NULL, "rolloverEnabled" = false WHERE "householdId" = $1`, [
      E2E_HOUSEHOLD.id,
    ]);
    await insertHouseholdCategory(client, { id: `e2e-u117-inc-${tag}`, name: `Salary ${tag}`, type: "INCOME" });
    await insertHouseholdCategory(client, { id: `e2e-u117-cat-${tag}`, name: `Groceries ${tag}` });
    await insertHouseholdTransaction(client, {
      id: `e2e-u117-in-${tag}`,
      categoryId: `e2e-u117-inc-${tag}`,
      amount: 3100,
      type: "INCOME",
    });
    await insertHouseholdTransaction(client, {
      id: `e2e-u117-ex-${tag}`,
      categoryId: `e2e-u117-cat-${tag}`,
      amount: 100,
    });
  });

  await page.goto("/dashboard/budget");
  const main = page.getByRole("main");
  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  if (daysLeft === 1) {
    await expect(main.getByText(/≈\s*\S+ for today, the last day of the month\./)).toBeVisible();
  } else {
    await expect(main.getByText(new RegExp(`≈\\s*\\S+ per day for the ${daysLeft} days left\\.`))).toBeVisible();
  }

  // Both chart labels print an amount: today's is the headline, 3 000.00.
  // The chart sits behind "How we got this number" (budget redesign, Oct 2026).
  await main.getByText("How we got this number").click();
  await expect(main.getByText(/^Today\s+3\D?000[.,]00/).first()).toBeVisible();
  await expect(main.getByText(/^Month end\s+-?\d/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
