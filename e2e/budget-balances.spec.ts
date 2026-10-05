import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// PERF-12: the Balances card no longer loads every split bill the household
// ever logged, only the ones that aren't settled. This pins, through the
// browser, that skipping settled bills changes nothing visible: an open bill
// still lists what's left due and still counts towards "who owes whom",
// while fully paid ones (however many) stay out of both. Rows go straight to
// Postgres, like personal-budget-shared.spec.ts, and are named uniquely
// since the desktop and mobile runs share the seeded household.
const suffix = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seedBills() {
  const tag = suffix();
  const open = `Open bill ${tag}`;
  const settled = `Settled bill ${tag}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Bills', 'EXPENSE')`,
      [`e2e-bal-cat-${tag}`, E2E_HOUSEHOLD.id],
    );
    const bill = async (id: string, description: string, amount: number, paid: [number, number]) => {
      await client.query(
        `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, description, date)
         VALUES ($1, $2, $3, $4, 'EXPENSE', $5, date_trunc('month', now()) + interval '10 days')`,
        [id, E2E_HOUSEHOLD.id, `e2e-bal-cat-${tag}`, amount, description],
      );
      await client.query(
        `INSERT INTO "TransactionSplit" (id, "transactionId", "householdMemberId", "amountOwed", "amountPaid")
         VALUES ($1, $3, 'e2e-member', $4, $5), ($2, $3, 'e2e-member-sv', $4, $6)`,
        [`${id}-a`, `${id}-b`, id, amount / 2, paid[0], paid[1]],
      );
    };
    // Open: nobody has paid, 777 left due — must be listed.
    await bill(`e2e-bal-open-${tag}`, open, 777, [0, 0]);
    // Settled: both paid their half exactly — must not be listed.
    await bill(`e2e-bal-settled-${tag}`, settled, 500, [250, 250]);
  } finally {
    await client.end();
  }
  return { open, settled };
}

test("balances list open split bills and leave out settled ones", async ({ page }) => {
  const { open, settled } = await seedBills();

  await page.goto("/dashboard/budget?tab=insights");
  await expect(page.getByText("Still due on bills")).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: open });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/777/);
  await expect(page.getByText(settled)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
