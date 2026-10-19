import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTargetsApart, expectTouchTargets } from "./ui";

// Planned income: a one-off income expected on a date (a bonus, a tax
// refund, a win), the planned-bill rows (planned-expenses.spec.ts) in an
// income category. It's added in its own "Planned income" panel on the
// Manage tab, counts in Safe to spend as expected income in the month it's
// due, and is received through the ordinary transaction dialog ("Log
// income"). Income that didn't arrive in its month shows as "Not received"
// and stops counting. The income category is seeded straight into Postgres;
// the planned income itself is made through the UI.
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

let householdCategoryId: string | undefined;
let personalCategoryId: string | undefined;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// Only rows in this worker's household (or of this worker's user) hanging
// off the category the test seeded: the transaction, the planned income,
// then the category itself.
test.afterEach(async () => {
  const householdId = householdCategoryId;
  const personalId = personalCategoryId;
  householdCategoryId = undefined;
  personalCategoryId = undefined;
  await withDb(async (client) => {
    if (householdId) {
      for (const table of ["Transaction", "PlannedExpense"]) {
        await client.query(`DELETE FROM "${table}" WHERE "householdId" = $1 AND "categoryId" = $2`, [
          E2E_HOUSEHOLD.id,
          householdId,
        ]);
      }
      await client.query(`DELETE FROM "BudgetCategory" WHERE "householdId" = $1 AND id = $2`, [
        E2E_HOUSEHOLD.id,
        householdId,
      ]);
    }
    if (personalId) {
      for (const table of ["PersonalTransaction", "PersonalPlannedExpense"]) {
        await client.query(`DELETE FROM "${table}" WHERE "userId" = $1 AND "categoryId" = $2`, [
          E2E_USER.id,
          personalId,
        ]);
      }
      await client.query(`DELETE FROM "PersonalBudgetCategory" WHERE "userId" = $1 AND id = $2`, [
        E2E_USER.id,
        personalId,
      ]);
    }
  });
});

// The "Planned income" panel, one of its groups ("Expected this month",
// "Received", …), and an item's row in that group. Scoped to the panel since
// the "Planned bills" panel next to it has groups of the same names.
function incomeGroup(page: Page, heading: string) {
  return page
    .getByRole("main")
    .getByRole("region", { name: "Planned income" })
    .getByRole("region", { name: heading });
}
function incomeRow(page: Page, heading: string, name: string) {
  return incomeGroup(page, heading).getByRole("listitem").filter({ hasText: name });
}

/** YYYY-MM-DD of the 15th of last month, in the browser's (and Node's) zone. */
function midLastMonthInputValue() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-15`;
}

test("adds household planned income, counts it this month and marks it received when logged", async ({
  page,
}, testInfo) => {
  const t = tag();
  const category = { id: `e2e-planned-income-cat-${t}`, name: `Bonuses ${t}` };
  await withDb((client) =>
    client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, $3, 'INCOME')`,
      [category.id, E2E_HOUSEHOLD.id, category.name],
    ),
  );
  householdCategoryId = category.id;
  const name = `Tax refund ${t}`;
  const main = page.getByRole("main");

  // --- Add it: today's date by default, so it's expected this month --------
  await page.goto("/dashboard/budget?tab=manage");
  const panel = main.getByRole("region", { name: "Planned income" });
  await panel.getByRole("button", { name: "Add planned income" }).click();
  const dialog = page.getByRole("dialog", { name: "Add planned income" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Amount").fill("4500");
  await dialog.getByRole("combobox", { name: "Category" }).fill(category.name);
  await page.getByRole("option", { name: category.name, exact: true }).click();
  await expect(dialog.getByLabel("Expected on")).toBeVisible();
  // Income isn't split between members, whatever the household's size.
  await expect(dialog.getByRole("checkbox", { name: "Split this bill" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  const expectedRow = incomeRow(page, "Expected this month", name);
  await expect(expectedRow).toBeVisible();
  await expect(expectedRow).toContainText(/4[\s,.]?500/);
  await expect(expectedRow).toContainText("Expected");
  // It's income, not a bill: never listed under Planned bills.
  await expect(main.getByRole("region", { name: "Planned bills" }).getByText(name)).toHaveCount(0);
  if (testInfo.project.name.startsWith("mobile")) {
    await expectTouchTargets(page);
    await expectTargetsApart(incomeGroup(page, "Expected this month"));
  }

  // --- It's expected income in Safe to spend and in the due strip ----------
  await page.getByRole("tab", { name: "Overview" }).click();
  await main.getByText("How we got this number").click();
  const stillDue = main.getByText("Still due this month").locator("xpath=following-sibling::ul");
  const breakdownRow = stillDue.getByRole("listitem").filter({ hasText: name });
  await expect(breakdownRow).toBeVisible();
  await expect(breakdownRow).toContainText("+");
  const dueStrip = main.locator('[data-slot="card"]').filter({ hasText: "Due this period" });
  const stripRow = dueStrip.getByText(name, { exact: true }).locator("xpath=ancestor::div[.//button][1]");
  await expect(stripRow.getByRole("button", { name: "Log income" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // --- Log it as received --------------------------------------------------
  await page.goto("/dashboard/budget?tab=manage");
  await incomeRow(page, "Expected this month", name).getByRole("button", { name: "Log income" }).click();
  const txDialog = page.getByRole("dialog", { name: "Add transaction" });
  await expect(txDialog).toBeVisible();
  await expect(txDialog.getByLabel("Amount", { exact: true })).toHaveValue("4500");
  await txDialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(txDialog).toBeHidden();
  await expect(page.getByText(`${name} marked as received.`)).toBeVisible();

  await page.reload();
  const receivedRow = incomeRow(page, "Received", name);
  await expect(receivedRow).toBeVisible();
  await expect(receivedRow.getByRole("button", { name: "Log income" })).toHaveCount(0);
  await expect(receivedRow.getByRole("button", { name: `Delete ${name}` })).toHaveCount(0);

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(dueStrip.getByText(name, { exact: true })).toHaveCount(0);
});

test("shows personal planned income that didn't arrive as not received and keeps it out of the due strip", async ({ page }) => {
  const t = tag();
  const category = { id: `e2e-personal-planned-income-cat-${t}`, name: `Extra ${t}` };
  await withDb((client) =>
    client.query(
      `INSERT INTO "PersonalBudgetCategory" (id, "userId", name, type) VALUES ($1, $2, $3, 'INCOME')`,
      [category.id, E2E_USER.id, category.name],
    ),
  );
  personalCategoryId = category.id;
  const name = `Bonus ${t}`;
  const main = page.getByRole("main");

  await page.goto("/dashboard/personal-budget?tab=manage");
  await main
    .getByRole("region", { name: "Planned income" })
    .getByRole("button", { name: "Add planned income" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add planned income" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Amount").fill("9000");
  await dialog.getByRole("combobox", { name: "Category" }).fill(category.name);
  await page.getByRole("option", { name: category.name, exact: true }).click();
  await dialog.getByLabel("Expected on").fill(midLastMonthInputValue());
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  const lateRow = incomeRow(page, "Not received", name);
  await expect(lateRow).toBeVisible();
  // Still loggable, in case it did come in after all.
  await expect(lateRow.getByRole("button", { name: "Log income" })).toBeVisible();

  // Late income may never come, so it doesn't nag in the due strip (that it
  // stops counting in Safe to spend is covered by the calculator's unit
  // tests). The Manage tab stays mounted, hidden, hence only visible matches.
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(main.getByText("Due this period").filter({ visible: true })).toBeVisible();
  await expect(main.getByText(name).filter({ visible: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
