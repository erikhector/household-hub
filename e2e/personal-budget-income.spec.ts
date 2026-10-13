import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// A recurring income (a salary) must count in the months it hasn't been
// logged yet, the same way recurring bills and savings already do — a
// future month used to show every bill due but none of the income paying
// for them. Rows are written straight to Postgres, like
// personal-budget-shared.spec.ts does, and named uniquely since the desktop
// and mobile runs share the seeded user.
const suffix = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seedRecurringSalary(): Promise<string> {
  const tag = suffix();
  const name = `Salary ${tag}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "PersonalBudgetCategory" (id, "userId", name, type) VALUES ($1, $2, $3, 'INCOME')`,
      [`e2e-personal-cat-${tag}`, E2E_USER.id, name],
    );
    await client.query(
      `INSERT INTO "PersonalRecurringTemplate" (id, "userId", "categoryId", name, amount, type, frequency)
       VALUES ($1, $2, $3, $4, 45678, 'INCOME', 'MONTHLY')`,
      [`e2e-personal-tpl-${tag}`, E2E_USER.id, `e2e-personal-cat-${tag}`, name],
    );
  } finally {
    await client.end();
  }
  return name;
}

test("a recurring income shows as expected income next month", async ({ page }) => {
  const name = await seedRecurringSalary();
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;

  await page.goto(`/dashboard/personal-budget?month=${nextKey}`);
  const main = page.getByRole("main");
  await expect(main.getByText("Expected income", { exact: true })).toBeVisible();
  // Listed under "Still due this month" as money coming in, not going out.
  const row = main.getByRole("listitem").filter({ hasText: name });
  await expect(row.getByText("Income", { exact: true })).toBeVisible();
  await expect(row.getByText(/^\+\D*45[\s,.  ]?678/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
