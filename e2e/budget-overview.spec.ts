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
