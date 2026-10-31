import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_MEMBER, E2E_MEMBER_SV } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, saveScreenshot } from "./ui";

// UX-114: "Who owes whom" is somewhere you see it once somebody owes
// something (it's the only card with an action on it). Budget redesign (Oct
// 2026): that's the Overview, under Needs attention, rather than the top of
// Insights. The grocery cost cards that have nothing to show collapse into
// one quiet line instead of five boxes of "No ... yet", behind Insights'
// "Grocery prices, stores and waste" disclosure. Rows go straight to Postgres, like
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

test("who owes whom is on the Overview while somebody owes, and empty cost cards collapse to one line", async ({
  page,
}, testInfo) => {
  await seedOpenBill();
  await page.goto("/dashboard/budget");
  const main = page.getByRole("main");

  const balances = main.getByText("Who owes whom", { exact: true }).filter({ visible: true });
  await expect(balances).toBeVisible();
  // Only writes a file under E2E_SCREENSHOT_DIR, for the UX before/after look.
  await saveScreenshot(page, testInfo, "en", { pattern: "/dashboard/budget-overview-debt", path: "" });
  // Under Needs attention: what's due comes first, then settling up.
  const needs = main.getByRole("heading", { name: /^Needs attention/ });
  expect((await balances.boundingBox())!.y).toBeGreaterThan((await needs.boundingBox())!.y);

  // Not on Insights as well.
  await page.goto("/dashboard/budget?tab=insights");
  await expect(main.getByText("Who owes whom", { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(main.getByText("Expenses by category").first()).toBeVisible();

  await main.getByText("Grocery prices, stores and waste").click();
  await expect(main.getByText("Price and pantry insights appear once you scan receipts")).toBeVisible();
  await expect(main.getByText("No priced grocery purchases yet")).toHaveCount(0);
  await expect(main.getByText("No comparisons yet")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

// The other half of the rule: with nothing owed, "Who owes whom" stays on
// Insights, last on the tab, and a cost card that has data still renders.
// budget-balances.spec.ts and the test above leave splits behind in this
// worker's household, so clear them first (scoped to E2E_HOUSEHOLD only).
test("with nothing owed, who owes whom stays last and a card with data still shows", async ({ page }) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM "TransactionSplit" WHERE "transactionId" IN (SELECT id FROM "Transaction" WHERE "householdId" = $1)`,
      [E2E_HOUSEHOLD.id],
    );
  } finally {
    await client.end();
  }
  await page.goto("/dashboard/budget?tab=insights");
  const main = page.getByRole("main");

  const balances = main.getByText("Who owes whom", { exact: true });
  await expect(balances).toBeVisible();
  const summary = main.getByText("Expenses by category").first();
  await expect(summary).toBeVisible();
  expect((await balances.boundingBox())!.y).toBeGreaterThan((await summary.boundingBox())!.y);

  // Seeded stock has no known price, so "On hand now" still renders, with
  // its own message rather than being folded into the collapse line. A
  // price-spike notification's link (`prices=1`) lands with the grocery
  // disclosure already open.
  await page.goto("/dashboard/budget?tab=insights&prices=1");
  await expect(main.getByText("On hand now", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
