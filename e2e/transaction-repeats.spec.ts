import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, insertHouseholdTransaction, withDb } from "./budget-seed";
import { dismissCookieNotice } from "./ui";

// UX-113: "This repeats" on a new transaction created no recurring item, yet
// moved next month's Safe to spend through a hidden fallback. A new
// transaction no longer offers it (a repeating bill is added under Manage >
// Recurring items). An existing transaction that already carries the flag
// still shows it, ticked, so it can be cleared.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a new transaction has no 'This repeats' box", async ({ page }) => {
  // Without a category the budget shows its set-up cards, not "Add
  // transaction", so this test brings its own instead of relying on rows an
  // earlier spec left in the worker's household.
  const tag = budgetTag();
  await withDb((client) => insertHouseholdCategory(client, { id: `e2e-rep-new-${tag}`, name: `Groceries ${tag}` }));
  await page.goto("/dashboard/budget");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add transaction" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Amount", { exact: true })).toBeVisible();
  await expect(dialog.getByText("This repeats")).toHaveCount(0);
  await expect(dialog.getByLabel("Frequency")).toHaveCount(0);
});

test("an already-flagged transaction still shows 'This repeats', ticked", async ({ page, isMobile }) => {
  const tag = budgetTag();
  const categoryId = `e2e-rep-cat-${tag}`;
  const described = `Gym ${tag}`;
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: categoryId, name: `Fitness ${tag}` });
    await insertHouseholdTransaction(client, {
      id: `${categoryId}-tx`,
      categoryId,
      amount: 250,
      description: described,
    });
    await client.query(
      `UPDATE "Transaction" SET "isRecurring" = true, "recurrenceFrequency" = 'MONTHLY' WHERE id = $1`,
      [`${categoryId}-tx`],
    );
  });

  await page.goto("/dashboard/budget?tab=transactions");
  const main = page.getByRole("main");
  if (isMobile) {
    await main.getByRole("button", { name: new RegExp(described) }).click();
  } else {
    await main.getByRole("row").filter({ hasText: described }).getByRole("button", { name: "Edit transaction" }).click();
  }
  const dialog = page.getByRole("dialog", { name: "Edit transaction" });
  await expect(dialog.getByRole("checkbox", { name: "This repeats" })).toBeChecked();
});
