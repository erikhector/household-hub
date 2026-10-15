import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTargetsApart, expectTouchTargets } from "./ui";

// Planned bills (BUDGET-8): a one-off bill with a due date, added on the
// Budget page's Manage tab, counted in Safe to spend until it's paid, and
// paid through the ordinary transaction dialog ("Log payment"). Deleting
// that transaction puts the bill back to due. The category is seeded straight
// into Postgres (like personal-budget-shared.spec.ts); the bill itself is
// made through the UI, since that's what's under test.
const tag = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

let categoryId: string | undefined;

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

async function seedCategory(): Promise<{ id: string; name: string }> {
  const t = tag();
  const id = `e2e-planned-cat-${t}`;
  const name = `Bills ${t}`;
  await withDb((client) =>
    client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, $3, 'EXPENSE')`,
      [id, E2E_HOUSEHOLD.id, name],
    ),
  );
  categoryId = id;
  return { id, name };
}

// Only rows in this worker's household, and only the ones hanging off the
// category this test seeded: the transaction (if a failed run left it), the
// bill, then the category itself.
test.afterEach(async () => {
  if (!categoryId) return;
  const id = categoryId;
  categoryId = undefined;
  await withDb(async (client) => {
    await client.query(`DELETE FROM "Transaction" WHERE "householdId" = $1 AND "categoryId" = $2`, [
      E2E_HOUSEHOLD.id,
      id,
    ]);
    await client.query(`DELETE FROM "PlannedExpense" WHERE "householdId" = $1 AND "categoryId" = $2`, [
      E2E_HOUSEHOLD.id,
      id,
    ]);
    await client.query(`DELETE FROM "BudgetCategory" WHERE "householdId" = $1 AND id = $2`, [
      E2E_HOUSEHOLD.id,
      id,
    ]);
  });
});

function todayInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// A group of the Planned bills panel ("Due this month", "Paid", …) and the
// bill's row in it.
function plannedGroup(page: Page, heading: string) {
  return page.getByRole("main").getByRole("region", { name: heading });
}
function plannedRow(page: Page, heading: string, name: string) {
  return plannedGroup(page, heading).getByRole("listitem").filter({ hasText: name });
}

test("adds a planned bill, logs its payment, and un-pays it when the transaction goes", async ({
  page,
}, testInfo) => {
  const category = await seedCategory();
  const name = `Car service ${tag()}`;
  const main = page.getByRole("main");

  // --- Add the bill -------------------------------------------------------
  await page.goto("/dashboard/budget?tab=manage");
  await main.getByRole("button", { name: "Add planned bill" }).click();
  const dialog = page.getByRole("dialog", { name: "Add planned bill" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Amount").fill("3000");
  await dialog.getByRole("combobox", { name: "Category" }).fill(category.name);
  await page.getByRole("option", { name: category.name, exact: true }).click();
  // Due date defaults to today (DESIGN.md M4: default what we can).
  await expect(dialog.getByLabel("Due date")).toHaveValue(todayInputValue());
  await dialog.getByRole("checkbox", { name: "Split this bill" }).check();
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  const dueRow = plannedRow(page, "Due this month", name);
  await expect(dueRow).toBeVisible();
  await expect(dueRow).toContainText("Due");
  await expect(dueRow).toContainText(/3[\s,.]?000/);
  if (testInfo.project.name.startsWith("mobile")) {
    await expectTouchTargets(page);
    await expectTargetsApart(plannedGroup(page, "Due this month"));
  }

  // --- It counts in Safe to spend ------------------------------------------
  await page.getByRole("tab", { name: "Overview" }).click();
  const stillDue = main.getByText("Still due this month").locator("xpath=following-sibling::ul");
  await expect(stillDue.getByRole("listitem").filter({ hasText: name })).toBeVisible();

  // --- It shows in the Overview's due strip ---------------------------------
  // The strip is a card (no landmark role), so find it by its heading.
  const dueStrip = main.locator('[data-slot="card"]').filter({ hasText: "Due this period" });
  const stripRow = dueStrip.getByText(name, { exact: true }).locator("xpath=ancestor::div[.//button][1]");
  await expect(stripRow).toBeVisible();
  await expect(stripRow.getByRole("button", { name: "Log payment" })).toBeVisible();
  if (testInfo.project.name.startsWith("mobile")) {
    await expectTouchTargets(page);
    await expectTargetsApart(dueStrip);
    await expectNoHorizontalOverflow(page);
  }

  // --- Log its payment -----------------------------------------------------
  await page.getByRole("tab", { name: "Manage" }).click();
  await dueRow.getByRole("button", { name: "Log payment" }).click();
  const txDialog = page.getByRole("dialog", { name: "Add transaction" });
  await expect(txDialog).toBeVisible();
  await expect(txDialog.getByLabel("Amount", { exact: true })).toHaveValue("3000");
  await txDialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(txDialog).toBeHidden();

  await page.reload();
  const paidRow = plannedRow(page, "Paid", name);
  await expect(paidRow).toBeVisible();
  // A paid bill can be edited but no longer logged or deleted.
  await expect(paidRow.getByRole("button", { name: "Log payment" })).toHaveCount(0);
  await expect(plannedRow(page, "Due this month", name)).toHaveCount(0);

  await page.getByRole("tab", { name: "Transactions" }).click();
  // The visible copy only: the table (desktop) and the cards (phone) both
  // render, one of them hidden by CSS.
  const txName = main.getByText(name, { exact: true }).filter({ visible: true });
  await expect(txName).toBeVisible();

  // --- Deleting the transaction makes the bill due again --------------------
  await txName
    .locator("xpath=ancestor::*[.//button[@aria-label='Delete transaction']][1]")
    .getByRole("button", { name: "Delete transaction" })
    .click();
  const confirm = page.getByRole("dialog", { name: "Delete this transaction?" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  // The dialog closes once the server has answered (the row itself can go
  // sooner, optimistically).
  await expect(confirm).toBeHidden();
  await expect(main.getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(0);

  await page.reload();
  await page.getByRole("tab", { name: "Manage" }).click();
  await expect(plannedRow(page, "Due this month", name)).toBeVisible();
  await expect(plannedRow(page, "Paid", name)).toHaveCount(0);
});
