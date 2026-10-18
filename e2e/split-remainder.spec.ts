import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, withDb } from "./budget-seed";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// Splitting a bill by hand shows what's still left to split as the shares
// are typed (476 bill, my share 300 → "176.00 of 476.00 left to split"),
// and how far over the total the shares are once they add up to more.
// Nothing is saved; the one category is seeded only because the budget
// page shows its setup screen until the household has one. The seeded
// household already has the two members (E2E Tester and E2E Testare).
let categoryId: string | undefined;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const tag = budgetTag();
  const id = `e2e-split-cat-${tag}`;
  await withDb((client) => insertHouseholdCategory(client, { id, name: `Dinner ${tag}` }));
  categoryId = id;
});

test.afterEach(async () => {
  if (!categoryId) return;
  const id = categoryId;
  categoryId = undefined;
  await withDb((client) =>
    client.query(`DELETE FROM "BudgetCategory" WHERE "householdId" = $1 AND id = $2`, [E2E_HOUSEHOLD.id, id]),
  );
});

test("the transaction dialog shows what's left to split as shares are typed", async ({ page }) => {
  await page.goto("/dashboard/budget");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add transaction" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Amount", { exact: true }).fill("476");
  await dialog.getByRole("checkbox", { name: "Split this expense" }).check();
  await dialog.getByLabel("Amount for E2E Tester").fill("300");
  await dialog.getByLabel("Amount for E2E Testare").fill("0");

  await expect(dialog.getByText(/176\.00.* of .*476\.00.* left to split\./)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add transaction" })).toBeDisabled();
  await expectNoHorizontalOverflow(page);

  // Over-split says by how much.
  await dialog.getByLabel("Amount for E2E Testare").fill("200");
  await expect(dialog.getByText(/The shares are .*24\.00.* more than the .*476\.00.* total\./)).toBeVisible();
  await expect(dialog.getByText(/left to split/)).toHaveCount(0);

  // Balanced: no note, and Add is back.
  await dialog.getByLabel("Amount for E2E Testare").fill("176");
  await expect(dialog.getByText(/left to split|more than the/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Add transaction" })).toBeEnabled();
});

test("the planned bill dialog shows what's left to split as shares are typed", async ({ page }) => {
  await page.goto("/dashboard/budget?tab=manage");
  await page.getByRole("main").getByRole("button", { name: "Add planned bill" }).click();
  const dialog = page.getByRole("dialog", { name: "Add planned bill" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Amount").fill("476");
  await dialog.getByRole("checkbox", { name: "Split this bill" }).check();
  // The shares start as an even split of the amount, so nothing is left.
  await expect(dialog.getByText(/left to split/)).toHaveCount(0);

  await dialog.getByLabel("Share for E2E Tester").fill("300");
  await dialog.getByLabel("Share for E2E Testare").fill("0");
  await expect(dialog.getByText(/176\.00.* of .*476\.00.* left to split\./)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
});
