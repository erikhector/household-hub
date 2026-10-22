import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, insertHouseholdTransaction, withDb } from "./budget-seed";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-138: Safe to spend also subtracts what is still unspent of a category's
// monthly limit, shown as its own "Still budgeted" line, and the pace
// projection is a muted qualifier under the headline rather than a second
// "left" figure of the same weight.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the headline holds back an untouched limit and shows it as Still budgeted", async ({ page }) => {
  const tag = budgetTag();
  await withDb(async (client) => {
    // An empty month first (only E2E_HOUSEHOLD's rows): other specs leave
    // limited categories behind, and those would hold money back too.
    await client.query(`DELETE FROM "RecurringTemplate" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
    await client.query(`DELETE FROM "PlannedExpense" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
    await client.query(`DELETE FROM "Transaction" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
    await client.query(`UPDATE "BudgetCategory" SET "monthlyLimit" = NULL, "rolloverEnabled" = false WHERE "householdId" = $1`, [
      E2E_HOUSEHOLD.id,
    ]);
    await insertHouseholdCategory(client, { id: `e2e-u138-inc-${tag}`, name: `Salary ${tag}`, type: "INCOME" });
    // A limited category with no spending at all, and an unlimited one with
    // 10 of everyday spending (which is what the projection needs).
    await insertHouseholdCategory(client, { id: `e2e-u138-lim-${tag}`, name: `Food ${tag}`, monthlyLimit: 1000 });
    await insertHouseholdCategory(client, { id: `e2e-u138-cat-${tag}`, name: `Coffee ${tag}` });
    await insertHouseholdTransaction(client, {
      id: `e2e-u138-in-${tag}`,
      categoryId: `e2e-u138-inc-${tag}`,
      amount: 3100,
      type: "INCOME",
    });
    await insertHouseholdTransaction(client, {
      id: `e2e-u138-ex-${tag}`,
      categoryId: `e2e-u138-cat-${tag}`,
      amount: 10,
    });
  });

  await page.goto("/dashboard/budget");
  const main = page.getByRole("main");

  // 3 100 in, 10 spent and 1 000 still budgeted for Food: 2 090 is safe to
  // spend, not the 3 090 the limit used to leave in.
  await expect(main.getByText(/^\+?2\D?090[.,]00$/).first()).toBeVisible();

  // The arithmetic is a tap away on the compact card, with the new line.
  await main.getByText("How we got this number").click();
  const label = main.getByText("Still budgeted", { exact: true });
  await expect(label).toBeVisible();
  await expect(label.locator("xpath=..")).toContainText(/[–-]\s*1\D?000[.,]00/);

  // The projection is secondary text: small and muted, not another headline.
  const projection = main.locator("p", { hasText: /^About .+ left at the end of the month\.$/ });
  await expect(projection).toBeVisible();
  await expect(projection).toHaveClass(/text-xs/);
  await expect(projection).toHaveClass(/text-muted-foreground/);

  await expectNoHorizontalOverflow(page);
});
