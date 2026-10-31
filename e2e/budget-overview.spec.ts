import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, insertHouseholdTemplate, insertHouseholdTransaction, withDb } from "./budget-seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectTargetsApart, expectTouchTargets, openAllCategories } from "./ui";

// Phone pass (Oct 2026), P4, and the budget redesign (Oct 2026): Overview
// says each thing once. Safe to spend is the number, its summary and the
// daily allowance, with the totals, projection and arithmetic behind a
// disclosure; Needs attention is the one list of what's due, one line per
// item with "Log" and a "More" menu; Insights shows one breakdown at a time.
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

  await expect(main.getByText("Safe to spend", { exact: true }).first()).toBeVisible();
  // The totals and the arithmetic are a tap away, not on screen.
  const arithmetic = main.getByText("Remaining after expenses and savings", { exact: true }).filter({ visible: true });
  await expect(arithmetic).toHaveCount(0);
  // (Scoped to the card, so no other card's "Income" label can match.)
  const safeCard = main.locator('[data-slot="card"]').filter({ hasText: "How we got this number" });
  await expect(safeCard.getByText("Income", { exact: true }).filter({ visible: true })).toHaveCount(0);
  await main.getByText("How we got this number").click();
  await expect(arithmetic).toHaveCount(1);
  // Savings are set aside, not spent: the same "→" the transaction rows
  // use, never a minus.
  const savings = main.getByText("Savings", { exact: true }).filter({ visible: true }).first();
  await expect(savings.locator("xpath=following-sibling::dd")).toHaveText(/^→/);
  // UX-118: what's still due is the Due card's list, not repeated in here.
  await expect(main.getByText("Still due this month", { exact: true }).filter({ visible: true })).toHaveCount(0);
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

// Budget redesign (Oct 2026): "This month" on Insights is one breakdown at a
// time behind a switch, spending first, with no stat cards repeating Safe to
// spend.
test("Insights shows one breakdown at a time, spending first", async ({ page }) => {
  await seed();
  await page.goto("/dashboard/budget?tab=insights");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "This month" })).toBeVisible();
  const expensesTab = main.getByRole("tab", { name: "Expenses" });
  await expect(expensesTab).toHaveAttribute("aria-selected", "true");
  const expensesCard = main.getByText(/^Expenses by category/).filter({ visible: true });
  const incomeCard = main.getByText(/^Income by category/).filter({ visible: true });
  await expect(expensesCard).toHaveCount(1);
  await expect(incomeCard).toHaveCount(0);
  await expect(main.getByText("Remaining after expenses and savings").filter({ visible: true })).toHaveCount(0);

  await expectHydrated(expensesTab);
  await main.getByRole("tab", { name: "Income" }).click();
  await expect(incomeCard).toHaveCount(1);
  await expect(expensesCard).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

// UX-108: a category at 90% or more of its limit is on Overview, at the top
// of Needs attention right under Safe to spend, and the status line no
// longer says "good shape".
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

  await expect(main.getByRole("heading", { name: /^Needs attention/ })).toBeVisible();
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
  await openAllCategories(page);
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

// UX-118: a month from before the items existed has nothing due. It is not
// "set up recurring bills", which is for a household with none.
test("a month before the recurring items existed says nothing was due", async ({ page }) => {
  const { name } = await seed();
  const main = page.getByRole("main");

  await page.goto("/dashboard/budget?month=2020-01");
  await expect(main.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(main.getByText("Nothing was due this month", { exact: true })).toBeVisible();
  await expect(main.getByText("Add your regular bills and income")).toHaveCount(0);
  await expect(main.getByText(name)).toHaveCount(0);

  // This month the item is due, so the card lists it.
  await page.goto("/dashboard/budget");
  await expect(main.getByText("Nothing was due this month")).toHaveCount(0);
  await expect(main.getByRole("button", { name: `More actions for ${name}` })).toBeVisible();
  // Its link to Setup is a link: primary-coloured text, not a ghost label.
  const manage = main.getByRole("button", { name: "All bills & income" });
  await expect(manage).toBeVisible();
  const color = await manage.evaluate((el) => getComputedStyle(el).color);
  const body = await page.locator("body").evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe(body);
});

// Chart redesign (Oct 2026): under the number, a bar splits the month's
// income into where it goes, with a key that prints every part's amount, so
// the number explains itself without opening "How we got this number".
test("Safe to spend shows where the month's income goes", async ({ page, isMobile }) => {
  const tag = budgetTag();
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: `e2e-split-inc-${tag}`, name: `Wages ${tag}`, type: "INCOME" });
    await insertHouseholdCategory(client, { id: `e2e-split-exp-${tag}`, name: `Hardware ${tag}` });
    await insertHouseholdTransaction(client, {
      id: `e2e-split-tx-inc-${tag}`,
      categoryId: `e2e-split-inc-${tag}`,
      amount: 900000,
      type: "INCOME",
    });
    await insertHouseholdTransaction(client, { id: `e2e-split-tx-exp-${tag}`, categoryId: `e2e-split-exp-${tag}`, amount: 1234 });
  });
  await page.goto("/dashboard/budget");
  const main = page.getByRole("main");

  // The worker's household collects other specs' rows, so the amounts are
  // checked loosely: the title names the income, and both ends of the key
  // are there with a number each.
  await expect(main.getByText(/^Where this month's .+ goes$/)).toBeVisible();
  const key = main.getByRole("list").filter({ hasText: "Safe to spend" });
  await expect(key.getByText("Spent", { exact: true })).toBeVisible();
  await expect(key.getByRole("listitem").filter({ hasText: "Spent" })).toContainText(/\d/);
  await expect(key.getByRole("listitem").filter({ hasText: "Safe to spend" })).toContainText(/\d/);
  if (isMobile) await expectTouchTargets(page);
  await expectNoHorizontalOverflow(page);
});

// Budget redesign (Oct 2026): "{Month} at a glance" compares the month so far
// with the one before — income logged, spent, saved and what's not spent or
// saved, each with its change in words — and names the category furthest
// from its usual. Design review (Oct 2026): it leads Insights, not the
// Overview (M6).
test("Insights compares the month with the one before", async ({ page }) => {
  const tag = budgetTag();
  const now = new Date();
  // The 1st of this month and the two before it. "vs usual" compares a
  // running month up to the same day, so the earlier months' spending has
  // to fall on a day that's already been this month, whatever day the test
  // runs on: day 1 always has. (Noon UTC stays the 1st in any time zone.)
  const monthsAgo = (n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1, 12));
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: `e2e-glance-cat-${tag}`, name: `Bikes ${tag}` });
    for (const [n, amount] of [[0, 9000], [1, 100], [2, 100]] as const) {
      await insertHouseholdTransaction(client, {
        id: `e2e-glance-tx-${n}-${tag}`,
        categoryId: `e2e-glance-cat-${tag}`,
        amount,
        date: monthsAgo(n),
      });
    }
  });
  await page.goto("/dashboard/budget");
  const main = page.getByRole("main");
  await expect(main.getByText("Safe to spend", { exact: true }).first()).toBeVisible();
  await expect(main.getByRole("heading", { name: /at a glance$/ })).toBeHidden();

  await page.goto("/dashboard/budget?tab=insights");
  const card = main.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: /at a glance$/ }) });
  await expect(card).toBeVisible();
  await expect(card.getByText(/^Compared with /)).toBeVisible();
  // It says what it counts, so it isn't read against Safe to spend.
  await expect(card.getByText(/^From what's been logged\./)).toBeVisible();
  for (const label of ["Income logged", "Spent", "Saved"]) {
    const row = card.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) });
    // Each row says how it changed, in words.
    await expect(row).toContainText(/% more|% less|About the same|New this month/);
  }
  // What's not spent or saved changes by an amount, never a percentage
  // (near zero a percentage blows up).
  const left = card.getByRole("listitem").filter({ has: page.getByText("Not spent or saved", { exact: true }) });
  await expect(left).toContainText(/\d more$|\d less$|About the same$/);
  await expect(left).not.toContainText("%");
  await expect(card.getByText(new RegExp(`^Bikes ${tag}: \\d+% more than usual$`))).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

// The owner's donut (Oct 2026): Insights' expenses as slices to pick. Picking
// a category's name in the key lifts its slice, puts its amount and share in
// the hole and its notes and transactions link under the chart; "Show all"
// goes back. The key is the way in for touch, keyboard and screen readers.
test("Insights' expenses donut lets a category be picked and inspected", async ({ page, isMobile }) => {
  const tag = budgetTag();
  // Large enough to be one of the five named slices whatever else the
  // worker's household has spent this month.
  const name = `Boat ${tag}`;
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: `e2e-donut-cat-${tag}`, name, monthlyLimit: 1000000 });
    await insertHouseholdTransaction(client, { id: `e2e-donut-tx-${tag}`, categoryId: `e2e-donut-cat-${tag}`, amount: 900000 });
  });
  await page.goto("/dashboard/budget?tab=insights");
  const main = page.getByRole("main");
  await expect(main.getByText("Spent this month")).toBeVisible();

  const key = main.getByRole("button", { name: new RegExp(`^${name}`) });
  await expectHydrated(key);
  await key.click();
  await expect(key).toHaveAttribute("aria-pressed", "true");
  // Its notes, read out as they change: the limit it's measured against.
  // 900 000 of 1 000 000 is near the limit, a status: said in words, and
  // marked on its key row too (design review, Oct 2026).
  const status = main.getByRole("status").filter({ hasText: /of 1,000,000\.00/ });
  await expect(status).toBeVisible();
  await expect(status).toContainText("Almost at limit");
  await expect(key).toHaveAccessibleName(new RegExp(`^${name}\\s*Almost at limit`));
  await expect(main.getByRole("link", { name: "See transactions" })).toBeVisible();
  if (isMobile) await expectTouchTargets(page);
  await expectNoHorizontalOverflow(page);

  await main.getByRole("button", { name: "Show all" }).click();
  await expect(key).toHaveAttribute("aria-pressed", "false");
  await expect(main.getByText("Spent this month")).toBeVisible();

  // The link goes to that category's transactions.
  await key.click();
  await main.getByRole("link", { name: "See transactions" }).click();
  await expect(page).toHaveURL(/tab=transactions.*category=/);
});
