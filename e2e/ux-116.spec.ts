import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, insertHouseholdTransaction, withDb } from "./budget-seed";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-116: a budget with categories but no income and nothing recurring has
// no safe-to-spend number to show. The card asks for the two missing
// pieces instead of a green "+0.00" and "you're in good shape", and once
// there is income the totals carry a legend for the +, – and → glyphs.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("an empty budget asks for income and regular bills instead of a green zero", async ({ page }) => {
  const tag = budgetTag();
  await withDb(async (client) => {
    // Start from an empty month: this worker's household may hold rows from
    // earlier specs. Only E2E_HOUSEHOLD's rows are touched.
    await client.query(`DELETE FROM "RecurringTemplate" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
    await client.query(`DELETE FROM "PlannedExpense" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
    await client.query(`DELETE FROM "Transaction" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
    await insertHouseholdCategory(client, { id: `e2e-u116-cat-${tag}`, name: `Groceries ${tag}` });
  });

  await page.goto("/dashboard/budget");
  const main = page.getByRole("main");
  await expect(main.getByText("Add your income and regular bills to see what's safe to spend.")).toBeVisible();
  await expect(main.getByText("You're in good shape for the rest of the month.")).toBeHidden();
  await expect(main.getByRole("link", { name: "Add income" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Add regular bills" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await main.getByRole("link", { name: "Add regular bills" }).click();
  await expect(page).toHaveURL(/tab=manage/);

  // With income logged the number returns, and the glyphs are explained.
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: `e2e-u116-inc-${tag}`, name: `Salary ${tag}`, type: "INCOME" });
    await insertHouseholdTransaction(client, {
      id: `e2e-u116-tx-${tag}`,
      categoryId: `e2e-u116-inc-${tag}`,
      amount: 1000,
      type: "INCOME",
    });
  });
  await page.goto("/dashboard/budget");
  await expect(main.getByText("Add your income and regular bills to see what's safe to spend.")).toBeHidden();
  await expect(
    main.getByText("+ adds to what's safe to spend, – comes off it, → is set aside as savings."),
  ).toBeVisible();
});
