import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { dismissCookieNotice, expectTargetsApart, expectTouchTargets, expectTouchTargetsInTabs } from "./ui";

// UX-19 (M3): touch targets that were too small, overlapped or sat under 8 px
// from their neighbour, in the places the per-control size guard couldn't see.
// Phones only; a mouse keeps the denser sizing. The household is shared by the
// desktop and mobile runs, so rows are named uniquely and the meal goes in a
// far-future week of its own.
const suffix = () => Date.now().toString(36);

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "M3 is a touch rule");
  await dismissCookieNotice(context, baseURL!);
});

test("a meal row's edit, move and delete buttons are 44 px and 8 px apart", async ({ page }) => {
  const name = `Soup ${suffix()}`;
  await page.goto("/dashboard/meal-planning?week=2031-03-03");
  await page.getByRole("button", { name: "Add meal", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add a meal" });
  await dialog.getByRole("combobox", { name: "Meal" }).click();
  await page.getByRole("option", { name: "Lunch" }).click();
  await dialog.getByRole("textbox", { name: "Meal name" }).fill(name);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  const row = page.getByRole("main").getByText(name).locator("xpath=..");
  await expect(row.getByRole("button", { name: "Edit meal" })).toBeVisible();
  await expectTargetsApart(row);
  await expectTouchTargets(page);
});

test("category chips keep 44 px edit and delete buttons apart, in every budget tab", async ({ page }) => {
  const id = `e2e-ux19-cat-${suffix()}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, $3, 'EXPENSE')`, [
      id,
      E2E_HOUSEHOLD.id,
      `Hobbies ${id.slice(-6)}`,
    ]);
  } finally {
    await client.end();
  }
  await page.goto("/dashboard/budget");
  // Every tab is measured (the guard used to skip the hidden panels); the
  // chips live in one of them.
  await expectTouchTargetsInTabs(page);
  const edit = page.getByRole("button", { name: /^Edit Hobbies / });
  const tabs = page.getByRole("tab");
  for (let t = 0; t < (await tabs.count()); t++) {
    await tabs.nth(t).click();
    if (await edit.first().isVisible()) break;
  }
  await expect(edit.first()).toBeVisible();
  await expectTargetsApart(edit.first().locator("xpath=.."));
});

test("smart-add suggestions are 44 px tall", async ({ page }) => {
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  await page.getByRole("combobox", { name: "Add to the list" }).fill("Toma");
  await expect(page.getByRole("option").first()).toBeVisible();
  await expectTouchTargets(page);
});

test("the inventory row actions fit a 320 px phone without overlapping", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/dashboard/inventory");
  await expectTargetsApart(page.getByRole("main"));
  await expectTouchTargets(page);
});
