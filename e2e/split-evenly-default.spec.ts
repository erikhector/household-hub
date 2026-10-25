import { expect, test, type Page } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, withDb } from "./budget-seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-111: a split starts even. Ticking "Split this expense" with an amount
// typed shows equal shares and no mismatch error, the shares follow the
// amount until one is edited, and the person logging it is the payer.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function openAddDialog(page: Page) {
  const tag = budgetTag();
  await withDb((client) => insertHouseholdCategory(client, { id: `e2e-split-even-cat-${tag}`, name: `Dinner ${tag}` }));
  await page.goto("/dashboard/budget");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add transaction" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("ticking Split after typing the amount shows an even split with no error", async ({ page }) => {
  const dialog = await openAddDialog(page);
  await dialog.getByLabel("Amount", { exact: true }).fill("940");
  await dialog.getByRole("checkbox", { name: "Split this expense" }).check();

  const shares = dialog.getByLabel(/^Amount for /);
  await expect(shares).toHaveCount(2);
  await expect(shares.nth(0)).toHaveValue("470.00");
  await expect(shares.nth(1)).toHaveValue("470.00");
  await expect(dialog.getByText(/left to split|more than the/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Add transaction" })).toBeEnabled();

  // The person logging it paid the whole bill.
  const paid = await dialog.getByLabel(/^Paid by /).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(paid.sort()).toEqual(["0", "940"]);
  await expectNoHorizontalOverflow(page);
});

test("shares follow the amount until one is edited", async ({ page }) => {
  const dialog = await openAddDialog(page);
  await dialog.getByRole("checkbox", { name: "Split this expense" }).check();
  const amount = dialog.getByLabel("Amount", { exact: true });
  const shares = dialog.getByLabel(/^Amount for /);

  await amount.fill("100");
  await expect(shares.nth(0)).toHaveValue("50.00");
  await expect(shares.nth(1)).toHaveValue("50.00");

  await shares.nth(0).fill("70");
  await shares.nth(1).fill("30");
  await amount.fill("200");
  await expect(shares.nth(0)).toHaveValue("70");
  await expect(dialog.getByText(/100\.00.* of .*200\.00.* left to split\./)).toBeVisible();

  await dialog.getByRole("button", { name: "Split evenly" }).click();
  await expect(shares.nth(0)).toHaveValue("100.00");
  await expect(dialog.getByText(/left to split|more than the/)).toHaveCount(0);
});
