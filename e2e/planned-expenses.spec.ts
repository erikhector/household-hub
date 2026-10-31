import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { addBillOrIncome, dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectTargetsApart, expectTouchTargets, waitForUndoableDelete } from "./ui";

// Planned bills (BUDGET-8): a one-off bill with a due date, added on the
// Budget page's Setup tab, counted in Safe to spend until it's paid, and
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

// The one-off half of the Setup tab's Bills & income card, and the bill's
// row in it carrying a status chip ("Due this month", "Paid", …).
function plannedGroup(page: Page) {
  return page.getByRole("main").getByRole("region", { name: "Once" });
}
function plannedRow(page: Page, status: string, name: string) {
  return plannedGroup(page).getByRole("listitem").filter({ hasText: name }).filter({ hasText: status });
}

test("adds a planned bill, logs its payment, and un-pays it when the transaction goes", async ({
  page,
}, testInfo) => {
  // MAINT-59: the whole bill journey in one test, five page loads, three
  // dialogs and a delete that waits out its Undo toast (UX-49), which alone
  // is about 10 s. That is 17 s on an idle machine, so under three loaded
  // workers it ran into the default 30 s once (#694's gate). Each assertion
  // keeps its own 5 s wait; only the test's total budget grows.
  test.slow();
  const category = await seedCategory();
  const name = `Car service ${tag()}`;
  const main = page.getByRole("main");

  // --- Add the bill -------------------------------------------------------
  await page.goto("/dashboard/budget?tab=manage");
  await addBillOrIncome(page, "One-off bill");
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
    await expectTargetsApart(plannedGroup(page));
  }

  // --- It counts in Safe to spend ------------------------------------------
  await page.getByRole("tab", { name: "Overview" }).click();
  // The due strip below is the one list of what's due (UX-118), so the
  // bill is checked there, not repeated inside Safe to spend.

  // --- It shows in the Overview's due strip ---------------------------------
  // The strip is a card (no landmark role), so find it by its heading.
  const dueStrip = main.locator('[data-slot="card"]').filter({ hasText: "Needs attention" });
  const stripRow = dueStrip.getByText(name, { exact: true }).locator("xpath=ancestor::div[.//button][1]");
  await expect(stripRow).toBeVisible();
  await expect(stripRow.getByRole("button", { name: "Log payment" })).toBeVisible();
  if (testInfo.project.name.startsWith("mobile")) {
    await expectTouchTargets(page);
    await expectTargetsApart(dueStrip);
    await expectNoHorizontalOverflow(page);
  }

  // --- The user's share shows in Personal Budget ---------------------------
  // Split between E2E_MEMBER (the logged-in user) and E2E_MEMBER_SV, so 1500
  // of the 3000. Personal Budget's Overview needs a personal category, or it
  // shows its onboarding instead. Read-only there: no "Log payment".
  await withDb((client) =>
    client.query(
      `INSERT INTO "PersonalBudgetCategory" (id, "userId", name, type)
       VALUES ($2, $1, 'Food', 'EXPENSE') ON CONFLICT (id) DO NOTHING`,
      [E2E_USER.id, `e2e-personal-cat-food-${E2E_USER.id}`],
    ),
  );
  await page.goto("/dashboard/personal-budget");
  const personalDue = main.locator('[data-slot="card"]').filter({ hasText: "Needs attention" });
  const shareRow = personalDue.getByText(name, { exact: true }).locator("xpath=ancestor::div[.//a][1]");
  await expect(shareRow).toBeVisible();
  await expect(shareRow.getByText("Shared", { exact: true })).toBeVisible();
  await expect(shareRow).toContainText(/Your share:\s*1[\s,.]?500/);
  await expect(shareRow.getByRole("button", { name: "Log payment" })).toHaveCount(0);
  await expect(shareRow.getByRole("link", { name: /Budget/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // --- Log its payment -----------------------------------------------------
  await page.goto("/dashboard/budget?tab=manage");
  await dueRow.getByRole("button", { name: "Log payment" }).click();
  const txDialog = page.getByRole("dialog", { name: "Add transaction" });
  await expect(txDialog).toBeVisible();
  await expect(txDialog.getByLabel("Amount", { exact: true })).toHaveValue("3000");
  await txDialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(txDialog).toBeHidden();
  // Paid once, not "logged for this period" like a recurring item.
  await expect(page.getByText(`${name} marked as paid.`)).toBeVisible();

  await page.reload();
  const paidRow = plannedRow(page, "Paid", name);
  await expect(paidRow).toBeVisible();
  // A paid bill can be edited but no longer logged or deleted.
  await expect(paidRow.getByRole("button", { name: "Log payment" })).toHaveCount(0);
  await expect(plannedRow(page, "Due this month", name)).toHaveCount(0);

  await page.getByRole("tab", { name: "Activity" }).click();
  // The visible copy only: the table (desktop) and the cards (phone) both
  // render, one of them hidden by CSS.
  const txName = main.getByText(name, { exact: true }).filter({ visible: true });
  await expect(txName).toBeVisible();

  // --- Deleting the transaction makes the bill due again --------------------
  if (testInfo.project.name.startsWith("mobile")) {
    // A phone row is itself the edit button; Delete lives in its sheet.
    await main.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await page.getByRole("dialog", { name: "Edit transaction" }).getByRole("button", { name: "Delete transaction" }).click();
  } else {
    await txName
      .locator("xpath=ancestor::*[.//button[@aria-label='Delete transaction']][1]")
      .getByRole("button", { name: "Delete transaction" })
      .click();
  }
  // UX-49: no confirm; the row goes at once and the delete reaches the
  // server when the Undo toast closes.
  await expect(main.getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(0);
  await waitForUndoableDelete(page, `Deleted "${name}"`);

  // Closing the sheets steps back over their history entries, and a reload
  // racing that back() is aborted (see budget-transaction-rows.spec.ts).
  await expect(async () => {
    await page.reload();
  }).toPass();
  await page.getByRole("tab", { name: "Setup" }).click();
  await expect(plannedRow(page, "Due this month", name)).toBeVisible();
  await expect(plannedRow(page, "Paid", name)).toHaveCount(0);
});

// A bill due last month but paid this month is still "due" when last month
// is viewed (past months stay historical), yet it already has its payment:
// Log payment would only fail and Delete would silently detach that payment,
// so neither is offered there — on Setup or in Needs attention.
test("a bill paid after its month shows as paid later, with no Log payment or Delete, in that month", async ({
  page,
}) => {
  const category = await seedCategory();
  const t = tag();
  const name = `Late fee ${t}`;
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12));
  const monthKey = `${lastMonth.getUTCFullYear()}-${String(lastMonth.getUTCMonth() + 1).padStart(2, "0")}`;
  const billId = `e2e-planned-late-${t}`;
  await withDb(async (client) => {
    await client.query(
      `INSERT INTO "PlannedExpense" (id, "householdId", "categoryId", name, amount, "dueDate")
       VALUES ($1, $2, $3, $4, 800, $5)`,
      [billId, E2E_HOUSEHOLD.id, category.id, name, lastMonth],
    );
    await client.query(
      `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, description, date, "plannedExpenseId")
       VALUES ($1, $2, $3, 800, 'EXPENSE', $4, $5, $6)`,
      [`e2e-planned-late-tx-${t}`, E2E_HOUSEHOLD.id, category.id, name, now, billId],
    );
  });
  const main = page.getByRole("main");

  await page.goto(`/dashboard/budget?tab=manage&month=${monthKey}`);
  const row = plannedRow(page, "Due this month", name);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Paid");
  await expect(row.getByRole("button", { name: "Log payment" })).toHaveCount(0);
  // Its "…" menu still offers Edit, but not Delete.
  const more = row.getByRole("button", { name: `More actions for ${name}` });
  await expectHydrated(more);
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Overview" }).click();
  const dueStrip = main.locator('[data-slot="card"]').filter({ hasText: "Needs attention" });
  const stripRow = dueStrip.getByText(name, { exact: true }).locator("xpath=ancestor::div[contains(@class,'border')][1]");
  await expect(stripRow).toBeVisible();
  await expect(stripRow).toContainText("Paid");
  await expect(stripRow.getByRole("button", { name: "Log payment" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

// Design review of the budget redesign: a one-off row acts like a repeating
// one on the same card — its status chip, one visible action (Log payment)
// and a "…" menu with Edit and Delete, Delete confirmed. Closing a dialog
// opened from the menu hands focus back to the "…" button.
test("a one-off bill is one line: its status, Log payment and a More menu", async ({ page, isMobile }) => {
  const category = await seedCategory();
  const t = tag();
  const name = `Dentist ${t}`;
  await withDb((client) =>
    client.query(
      `INSERT INTO "PlannedExpense" (id, "householdId", "categoryId", name, amount, "dueDate")
       VALUES ($1, $2, $3, $4, 450, $5)`,
      [`e2e-planned-row-${t}`, E2E_HOUSEHOLD.id, category.id, name, new Date()],
    ),
  );

  await page.goto("/dashboard/budget?tab=manage");
  const row = plannedRow(page, "Due this month", name);
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Log payment" })).toBeVisible();
  // The old pencil and trash icons are gone from the row.
  await expect(row.getByRole("button", { name: `Edit ${name}` })).toHaveCount(0);
  await expect(row.getByRole("button", { name: `Delete ${name}` })).toHaveCount(0);
  const more = row.getByRole("button", { name: `More actions for ${name}` });
  if (isMobile) {
    await expectTargetsApart(row);
    await expectTouchTargets(page);
  }
  await expectNoHorizontalOverflow(page);

  await expectHydrated(more);
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit planned bill" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(more).toBeFocused();

  await more.click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: `Delete ${name}?` }).getByRole("button", { name: "Delete" }).click();
  await expect(plannedRow(page, "Due this month", name)).toHaveCount(0);
});

// UX-13: a save the server turns down keeps what was typed, so the user
// fixes one thing and saves again instead of starting over. The category is
// deleted behind the open dialog's back to get a real server-side error.
test("keeps the typed name and category when the server rejects a save", async ({ page }) => {
  const category = await seedCategory();
  const name = `Boiler check ${tag()}`;

  await page.goto("/dashboard/budget?tab=manage");
  await addBillOrIncome(page, "One-off bill");
  const dialog = page.getByRole("dialog", { name: "Add planned bill" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Amount").fill("450");
  const categoryInput = dialog.getByRole("combobox", { name: "Category" });
  await categoryInput.fill(category.name);
  await page.getByRole("option", { name: category.name, exact: true }).click();

  await withDb((client) =>
    client.query(`DELETE FROM "BudgetCategory" WHERE "householdId" = $1 AND id = $2`, [
      E2E_HOUSEHOLD.id,
      category.id,
    ]),
  );
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("Category not found");
  await expect(dialog.getByLabel("Name")).toHaveValue(name);
  await expect(categoryInput).toHaveValue(category.name);
  await expect(dialog.getByLabel("Amount")).toHaveValue("450");
});
