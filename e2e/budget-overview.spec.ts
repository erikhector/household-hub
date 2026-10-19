import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, insertHouseholdTemplate, insertHouseholdTransaction, withDb } from "./budget-seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTargetsApart, expectTouchTargets } from "./ui";

// Phone pass (Oct 2026), P4: Overview says each thing once. Safe to spend
// is the number plus one totals line, with the arithmetic behind a
// disclosure; the due widget is the one list of what's due, one line per
// item with "Log" and a "More" menu; the month's stat cards live on
// Insights only, two by two on a phone.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seed() {
  const tag = budgetTag();
  const name = `Streaming ${tag}`;
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: `e2e-ovw-cat-${tag}`, name: `Subscriptions ${tag}` });
    await insertHouseholdTransaction(client, { id: `e2e-ovw-tx-${tag}`, categoryId: `e2e-ovw-cat-${tag}`, amount: 20 });
    await insertHouseholdTemplate(client, { id: `e2e-ovw-tpl-${tag}`, categoryId: `e2e-ovw-cat-${tag}`, name, amount: 129 });
  });
  return { name };
}

test("Overview shows each number once and keeps due items to one line", async ({ page, isMobile }) => {
  const { name } = await seed();
  await page.goto("/dashboard/budget");
  const main = page.getByRole("main");

  await expect(main.getByText("Safe to spend", { exact: true })).toBeVisible();
  // The arithmetic is a tap away, not on screen.
  // (Insights' stat card shares the wording, in its hidden tab panel.)
  const arithmetic = main.getByText("Remaining after expenses and savings", { exact: true }).filter({ visible: true });
  await expect(arithmetic).toHaveCount(0);
  // Savings are set aside, not spent: the same "→" the transaction rows
  // use, never a minus.
  const savings = main.getByText("Savings", { exact: true }).filter({ visible: true }).first();
  await expect(savings.locator("xpath=following-sibling::dd")).toHaveText(/^→/);
  await main.getByText("How we got this number").click();
  await expect(arithmetic).toHaveCount(1);
  // "This month" (PeriodSummary) isn't repeated on Overview.
  await expect(main.getByRole("heading", { name: "This month" })).toBeHidden();

  // One due item: its name, "Log" and "More" on one line.
  const log = main.getByRole("button", { name: "Log", exact: true });
  const more = main.getByRole("button", { name: `More actions for ${name}` });
  await expect(more).toBeVisible();
  const row = more.locator("xpath=..");
  const title = row.getByText(name, { exact: true });
  await expect(row.getByRole("button", { name: "Log", exact: true })).toBeVisible();
  const [rowBox, titleBox, moreBox] = [await row.boundingBox(), await title.boundingBox(), await more.boundingBox()];
  expect(rowBox!.height).toBeLessThanOrEqual(64);
  expect(Math.abs(titleBox!.y + titleBox!.height / 2 - (moreBox!.y + moreBox!.height / 2))).toBeLessThan(16);
  await expect(log.first()).toBeVisible();
  if (isMobile) {
    await expectTargetsApart(row);
    await expectTouchTargets(page);
  }
  await expectNoHorizontalOverflow(page);

  // The rarer actions are in the menu.
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Log as-is" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Mark as accounted for" }).click();
  await expect(more).toHaveCount(0);
});

test("Insights holds the month's stat cards, two by two on a phone", async ({ page, isMobile }) => {
  await seed();
  await page.goto("/dashboard/budget?tab=insights");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "This month" })).toBeVisible();
  const income = main.getByText("Income", { exact: true }).filter({ visible: true }).first();
  const expenses = main.getByText("Expenses", { exact: true }).filter({ visible: true }).first();
  const [a, b] = [await income.boundingBox(), await expenses.boundingBox()];
  if (isMobile) {
    // Side by side, not stacked.
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(4);
    expect(b!.x).toBeGreaterThan(a!.x);
  }
  await expectNoHorizontalOverflow(page);
});

// UX-108: a category at 90% or more of its limit is on Overview, right
// under Safe to spend, and the status line no longer says "good shape".
test("Overview lists categories near or over their limit", async ({ page }) => {
  const tag = budgetTag();
  const over = `Restaurants ${tag}`;
  const near = `Groceries ${tag}`;
  const fine = `Hobbies ${tag}`;
  await withDb(async (client) => {
    for (const [key, name, limit, spent] of [
      ["over", over, 800, 1355],
      ["near", near, 500, 450],
      ["fine", fine, 500, 100],
    ] as const) {
      await insertHouseholdCategory(client, { id: `e2e-lim-cat-${key}-${tag}`, name, monthlyLimit: limit });
      await insertHouseholdTransaction(client, {
        id: `e2e-lim-tx-${key}-${tag}`,
        categoryId: `e2e-lim-cat-${key}-${tag}`,
        amount: spent,
      });
    }
  });
  await page.goto("/dashboard/budget");
  const main = page.getByRole("main");

  await expect(main.getByText("Near or over their limit", { exact: true }).first()).toBeVisible();
  const overRow = main.getByRole("link", { name: new RegExp(over) });
  const nearRow = main.getByRole("link", { name: new RegExp(near) });
  await expect(overRow).toBeVisible();
  await expect(overRow).toContainText(/1[,\s.]?355.*\/.*800/);
  await expect(overRow).toContainText(/over/i);
  await expect(nearRow).toContainText("90% used");
  await expect(main.getByRole("link", { name: new RegExp(fine) })).toHaveCount(0);

  // Below Safe to spend, not further down the page.
  const safe = await main.getByText("Safe to spend", { exact: true }).first().boundingBox();
  const row = await overRow.boundingBox();
  expect(row!.y).toBeGreaterThan(safe!.y);

  // The status line no longer claims all is well.
  await expect(main.getByText("You're in good shape for the rest of the month.")).toBeHidden();

  // The row leads to that category's transactions.
  await overRow.click();
  await expect(page).toHaveURL(/tab=transactions/);
  await expectNoHorizontalOverflow(page);
});

// UX-115: "Expenses by category" bars carry status, not category: one
// neutral colour, warning with "Almost at limit" from 90%, destructive over.
test("Expenses by category bars are neutral, warning near the limit, destructive over", async ({ page }) => {
  const tag = budgetTag();
  const rows = [
    ["over", `Restaurants ${tag}`, 800, 1355],
    ["near", `Groceries ${tag}`, 500, 480],
    ["fine-a", `Hobbies ${tag}`, 500, 100],
    ["fine-b", `Clothes ${tag}`, 500, 180],
  ] as const;
  await withDb(async (client) => {
    for (const [key, name, limit, spent] of rows) {
      await insertHouseholdCategory(client, { id: `e2e-bar-cat-${key}-${tag}`, name, monthlyLimit: limit });
      await insertHouseholdTransaction(client, {
        id: `e2e-bar-tx-${key}-${tag}`,
        categoryId: `e2e-bar-cat-${key}-${tag}`,
        amount: spent,
      });
    }
  });
  await page.goto("/dashboard/budget?tab=insights");
  const main = page.getByRole("main");
  const row = (name: string) => main.getByRole("link", { name: new RegExp(`^${name} ${tag}`) });
  const barColour = (name: string) =>
    row(name).locator("div.h-full.rounded-full").evaluate((el) => getComputedStyle(el).backgroundColor);

  await expect(row("Groceries")).toContainText("Almost at limit");
  await expect(row("Restaurants")).toContainText(/over/i);
  await expect(row("Restaurants")).not.toContainText("Almost at limit");
  await expect(row("Hobbies")).not.toContainText("Almost at limit");

  const [hobbies, clothes, groceries, restaurants] = await Promise.all([
    barColour("Hobbies"),
    barColour("Clothes"),
    barColour("Groceries"),
    barColour("Restaurants"),
  ]);
  // Same neutral colour whatever the row's position, and status rows differ.
  expect(hobbies).toBe(clothes);
  expect(new Set([hobbies, groceries, restaurants]).size).toBe(3);
});
