import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_MEMBER, E2E_MEMBER_SV } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, saveScreenshot } from "./ui";

// UX-114: on Insights, "Who owes whom" leads the tab once somebody owes
// something (it's the only card there with an action on it), and the cost
// cards that have nothing to show collapse into one quiet line instead of
// five boxes of "No ... yet". Rows go straight to Postgres, like
// budget-balances.spec.ts, and are named uniquely since the desktop and
// mobile runs share the seeded household.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seedOpenBill() {
  const tag = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Bills', 'EXPENSE')`,
      [`e2e-ux114-cat-${tag}`, E2E_HOUSEHOLD.id],
    );
    await client.query(
      `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, description, date)
       VALUES ($1, $2, $3, 640, 'EXPENSE', $4, date_trunc('month', now()) + interval '10 days')`,
      [`e2e-ux114-tx-${tag}`, E2E_HOUSEHOLD.id, `e2e-ux114-cat-${tag}`, `Owed bill ${tag}`],
    );
    // The first member paid all of it, the second paid nothing: a debt.
    await client.query(
      `INSERT INTO "TransactionSplit" (id, "transactionId", "householdMemberId", "amountOwed", "amountPaid")
       VALUES ($1, $3, $4, 320, 640), ($2, $3, $5, 320, 0)`,
      [`e2e-ux114-sa-${tag}`, `e2e-ux114-sb-${tag}`, `e2e-ux114-tx-${tag}`, E2E_MEMBER, E2E_MEMBER_SV],
    );
  } finally {
    await client.end();
  }
}

test("who owes whom is in the first screenful and empty cost cards collapse to one line", async ({ page }, testInfo) => {
  await seedOpenBill();
  await page.goto("/dashboard/budget?tab=insights");
  const main = page.getByRole("main");

  const balances = main.getByText("Who owes whom", { exact: true });
  await expect(balances).toBeVisible();
  // Only writes a file under E2E_SCREENSHOT_DIR, for the UX before/after look.
  await saveScreenshot(page, testInfo, "en", { pattern: "/dashboard/budget-insights-debt", path: "" });
  const box = await balances.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(page.viewportSize()!.height);

  // Debt leads the tab: above the period summary's totals.
  const summary = main.getByText("Expenses by category").first();
  await expect(summary).toBeVisible();
  expect((await summary.boundingBox())!.y).toBeGreaterThan(box!.y);

  await expect(main.getByText("Price and pantry insights appear once you scan receipts")).toBeVisible();
  await expect(main.getByText("No priced grocery purchases yet")).toHaveCount(0);
  await expect(main.getByText("No comparisons yet")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
