import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_MEMBER, E2E_MEMBER_SV, E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// BUDGET-7: Personal Budget's Insights tab counts the user's share of a
// split household bill — in the month's totals (PeriodSummary) and in the
// "Fixed income & costs" card (its recurring-costs breakdown and trend).
// Rows are written straight to Postgres, like personal-budget-shared.spec.ts,
// and named uniquely since the desktop and mobile runs share the worker's
// household (which also collects other specs' shared bills, so amounts are
// checked on this bill's own rows, never on a household-wide total).
const suffix = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seedSharedRent(): Promise<{ category: string; template: string }> {
  const tag = suffix();
  const category = `Rent ${tag}`;
  const template = `Shared rent ${tag}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Personal Budget needs one personal category, or it shows onboarding.
    await client.query(
      `INSERT INTO "PersonalBudgetCategory" (id, "userId", name, type)
       VALUES ($2, $1, 'Food', 'EXPENSE') ON CONFLICT (id) DO NOTHING`,
      [E2E_USER.id, `e2e-personal-cat-food-${E2E_USER.id}`],
    );
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, $3, 'EXPENSE')`,
      [`e2e-cat-${tag}`, E2E_HOUSEHOLD.id, category],
    );
    await client.query(
      `INSERT INTO "RecurringTemplate" (id, "householdId", "categoryId", name, amount, type, frequency)
       VALUES ($1, $2, $3, $4, 12000, 'EXPENSE', 'MONTHLY')`,
      [`e2e-tpl-${tag}`, E2E_HOUSEHOLD.id, `e2e-cat-${tag}`, template],
    );
    // This month's rent, logged from the template and split 50/50.
    await client.query(
      `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, description, date, "recurringTemplateId")
       VALUES ($1, $2, $3, 12000, 'EXPENSE', $4, date_trunc('month', now()) + interval '1 day', $5)`,
      [`e2e-tx-${tag}`, E2E_HOUSEHOLD.id, `e2e-cat-${tag}`, template, `e2e-tpl-${tag}`],
    );
    await client.query(
      `INSERT INTO "TransactionSplit" (id, "transactionId", "householdMemberId", "amountOwed", "amountPaid")
       VALUES ($1, $3, $4, 6000, 12000), ($2, $3, $5, 6000, 0)`,
      [`e2e-split-a-${tag}`, `e2e-split-b-${tag}`, `e2e-tx-${tag}`, E2E_MEMBER, E2E_MEMBER_SV],
    );
  } finally {
    await client.end();
  }
  return { category, template };
}

test("a shared bill's share shows in the personal Insights totals and fixed costs", async ({ page }) => {
  const { category, template } = await seedSharedRent();

  await page.goto("/dashboard/personal-budget");
  const insights = page.getByRole("tab", { name: "Insights" }).last();
  await insights.scrollIntoViewIfNeeded();
  await insights.click();
  await expect(insights).toHaveAttribute("aria-selected", "true");

  // Each breakdown row is the name with its amount beside it. My half of the
  // 12000 bill, not the whole bill, even though I paid all of it.
  const half = /6[\s\u00a0\u202f,.]?000/;
  const main = page.getByRole("main");
  const monthRow = main.getByText(`${category} (Shared)`, { exact: true }).filter({ visible: true });
  await expect(monthRow).toBeVisible();
  await expect(monthRow.locator("..")).toContainText(half);

  const fixedRow = main.getByText(`${template} (Shared)`, { exact: true }).filter({ visible: true });
  await expect(fixedRow).toBeVisible();
  await expect(fixedRow.locator("..")).toContainText(half);

  // The logged share also feeds the fixed trend, so it has history to show.
  await expect(main.getByText(/Not enough history yet/).filter({ visible: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
