import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// A shared household bill split by hand when it was logged (no split on
// the recurring template itself) must still show on Personal Budget in the
// months it hasn't been logged yet — it used to vanish as soon as you
// stepped to next month. Rows are written straight to Postgres, like
// item-page.spec.ts does, and named uniquely since the desktop and mobile
// runs share the seeded household.
const suffix = () => Date.now().toString(36);

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seedHandSplitRent(): Promise<string> {
  const tag = suffix();
  const name = `Shared rent ${tag}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Personal Budget's Overview (where due bills show) needs at least one
    // personal category, or it shows its onboarding instead.
    await client.query(
      `INSERT INTO "PersonalBudgetCategory" (id, "userId", name, type)
       VALUES ('e2e-personal-cat-food', $1, 'Food', 'EXPENSE') ON CONFLICT (id) DO NOTHING`,
      [E2E_USER.id],
    );
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Rent', 'EXPENSE')`,
      [`e2e-cat-${tag}`, E2E_HOUSEHOLD.id],
    );
    await client.query(
      `INSERT INTO "RecurringTemplate" (id, "householdId", "categoryId", name, amount, type, frequency)
       VALUES ($1, $2, $3, $4, 12000, 'EXPENSE', 'MONTHLY')`,
      [`e2e-tpl-${tag}`, E2E_HOUSEHOLD.id, `e2e-cat-${tag}`, name],
    );
    // This month's rent, logged from the template and split 50/50 by hand.
    await client.query(
      `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, description, date, "recurringTemplateId")
       VALUES ($1, $2, $3, 12000, 'EXPENSE', $4, date_trunc('month', now()) + interval '14 days', $5)`,
      [`e2e-tx-${tag}`, E2E_HOUSEHOLD.id, `e2e-cat-${tag}`, name, `e2e-tpl-${tag}`],
    );
    await client.query(
      `INSERT INTO "TransactionSplit" (id, "transactionId", "householdMemberId", "amountOwed", "amountPaid")
       VALUES ($1, $3, 'e2e-member', 6000, 6000), ($2, $3, 'e2e-member-sv', 6000, 6000)`,
      [`e2e-split-a-${tag}`, `e2e-split-b-${tag}`, `e2e-tx-${tag}`],
    );
  } finally {
    await client.end();
  }
  return name;
}

test("a hand-split shared bill shows as due next month", async ({ page }) => {
  const name = await seedHandSplitRent();
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;

  await page.goto(`/dashboard/personal-budget?month=${nextKey}`);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  // Your half of it, not the whole bill.
  await expect(page.getByText(/6[\s,.]?000/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
