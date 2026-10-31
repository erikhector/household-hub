import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { collectErrors, dismissCookieNotice, expectNoHorizontalOverflow, expectTargetsApart, openAllCategories } from "./ui";

// UX-39: the budget charts are tappable, say their values without hover,
// and carry a hidden data table for screen readers; expense categories
// draw a spending sparkline; Safe to spend projects to the end of the
// month. Run on Personal Budget, whose rows belong to the seeded user, so
// the setup is a few direct inserts (as personal-budget-income.spec.ts
// does). Names are unique per run: desktop and mobile share the user.
const suffix = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

/** Noon on the given day `monthsAgo` months back, local time like the app. */
function dayIn(monthsAgo: number, day: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, day, 12);
}

async function seedSpending(): Promise<string> {
  const tag = suffix();
  const name = `Groceries ${tag}`;
  const categoryId = `e2e-personal-cat-${tag}`;
  const billCategoryId = `e2e-personal-bill-cat-${tag}`;
  const templateId = `e2e-personal-tpl-${tag}`;
  const today = new Date();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "PersonalBudgetCategory" (id, "userId", name, type) VALUES
         ($1, $2, $3, 'EXPENSE'), ($4, $2, $5, 'EXPENSE')`,
      [categoryId, E2E_USER.id, name, billCategoryId, `Phone ${tag}`],
    );
    await client.query(
      `INSERT INTO "PersonalRecurringTemplate" (id, "userId", "categoryId", name, amount, type, frequency)
       VALUES ($1, $2, $3, $4, 300, 'EXPENSE', 'MONTHLY')`,
      [templateId, E2E_USER.id, billCategoryId, `Phone ${tag}`],
    );
    // Everyday spending today and two months ago ("vs usual"), plus a
    // bill logged from the recurring item last month (the trend chart).
    // Today's row is dated today itself, so the month's pace has a day.
    await client.query(
      `INSERT INTO "PersonalTransaction" (id, "userId", "categoryId", amount, type, date, "recurringTemplateId") VALUES
         ($1, $4, $5, 123.45, 'EXPENSE', $7, NULL),
         ($2, $4, $5, 50, 'EXPENSE', $8, NULL),
         ($3, $4, $6, 300, 'EXPENSE', $9, $10)`,
      [
        `e2e-ptx-a-${tag}`,
        `e2e-ptx-b-${tag}`,
        `e2e-ptx-c-${tag}`,
        E2E_USER.id,
        categoryId,
        billCategoryId,
        new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 1),
        dayIn(2, 10),
        dayIn(1, 5),
        templateId,
      ],
    );
  } finally {
    await client.end();
  }
  return name;
}

test("safe to spend projects to month end and categories compare with usual", async ({ page }) => {
  const name = await seedSpending();
  const errors = collectErrors(page);
  await page.goto("/dashboard/personal-budget");
  const main = page.getByRole("main");

  // The projection says its number in words, not just as a line. It sits
  // behind "How we got this number" (budget redesign, Oct 2026).
  await main.getByText("How we got this number").click();
  await expect(main.getByText("At this pace", { exact: true })).toBeVisible();
  await expect(
    main.getByText(/^About .+ (left at the end of the month|over by the end of the month)\.$/),
  ).toBeVisible();
  await expect(main.getByText(/^Based on everyday spending of .+ a day so far\./)).toBeVisible();
  // …and as a table screen readers can walk.
  await expect(
    main.getByRole("table", { name: "Safe to spend today and projected for the end of the month" }),
  ).toBeAttached();

  // Chart redesign (Oct 2026): the category's row says how the month
  // compares with its usual, in words: 123.45 against the 50 two months ago
  // is 147% more. The month's category breakdown lives on Insights.
  await main.getByRole("tab", { name: "Insights" }).click();
  await openAllCategories(page);
  await expect(
    main.getByRole("link", { name: new RegExp(name) }).getByText("147% more than usual"),
  ).toBeVisible();

  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("the trend chart's bars are tappable and say their values", async ({ page, isMobile }) => {
  await seedSpending();
  const errors = collectErrors(page);
  await page.goto("/dashboard/personal-budget");
  const main = page.getByRole("main");
  await main.getByRole("tab", { name: "Insights" }).click();

  const monthLabel = new Intl.DateTimeFormat("en", { month: "short", year: "2-digit" });
  const thisMonth = monthLabel.format(dayIn(0, 1));
  const lastMonth = monthLabel.format(dayIn(1, 1));

  // The latest month starts selected, so the values show before any tap.
  const current = main.getByRole("button", { name: new RegExp(`^${thisMonth}: Income `) });
  await expect(current).toHaveAttribute("aria-pressed", "true");

  // Tapping last month selects it and the readout switches to its values
  // (the 300 bill counts in its costs).
  const previous = main.getByRole("button", { name: new RegExp(`^${lastMonth}: Income .+, Costs `) });
  await previous.click();
  await expect(previous).toHaveAttribute("aria-pressed", "true");
  await expect(current).toHaveAttribute("aria-pressed", "false");
  const readout = main.getByRole("status").filter({ hasText: lastMonth });
  await expect(readout).toBeVisible();
  await expect(readout.getByText("Costs", { exact: true })).toBeVisible();

  // The whole series is there for screen readers as a table.
  await expect(main.getByRole("table", { name: "Fixed income and costs by month" })).toBeAttached();

  // Chart redesign (Oct 2026): a scale from 0 to a clean top gives the bars
  // their meaning, and the chart starts at the first month with anything in
  // it rather than on a row of empty ones.
  const card = main.locator('[data-slot="card"]').filter({ hasText: "Fixed income & costs" });
  await expect(card.getByText("0", { exact: true })).toBeVisible();
  const months = card.getByRole("button", { name: /^\w{3} \d{2}: Income / });
  await expect(months.first()).not.toHaveAccessibleName(/Income 0\.00, Costs 0\.00, Savings 0\.00$/);

  // Each month is a full-size touch target (DESIGN.md M3).
  const box = await previous.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // ...and 8 px from its neighbours (M3), checked on the bar row itself.
  if (isMobile) await expectTargetsApart(previous.locator("xpath=.."));

  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
