import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTargetsApart, expectTouchTargets } from "./ui";

// Personal planned bills: the household's planned bills
// (planned-expenses.spec.ts) on Personal Budget, for the signed-in user only
// and with no split. Added on the Manage tab, counted in Safe to spend until
// paid, paid through the ordinary transaction dialog ("Log payment"), and
// never shown on the household's Budget page. The personal category is
// seeded straight into Postgres; the bill itself is made through the UI.
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
  const id = `e2e-personal-planned-cat-${t}`;
  const name = `Health ${t}`;
  await withDb((client) =>
    client.query(
      `INSERT INTO "PersonalBudgetCategory" (id, "userId", name, type) VALUES ($1, $2, $3, 'EXPENSE')`,
      [id, E2E_USER.id, name],
    ),
  );
  categoryId = id;
  return { id, name };
}

// Only this worker's user's rows hanging off the category this test seeded:
// the payment, the bill, then the category itself.
test.afterEach(async () => {
  if (!categoryId) return;
  const id = categoryId;
  categoryId = undefined;
  await withDb(async (client) => {
    for (const table of ["PersonalTransaction", "PersonalPlannedExpense"]) {
      await client.query(`DELETE FROM "${table}" WHERE "userId" = $1 AND "categoryId" = $2`, [E2E_USER.id, id]);
    }
    await client.query(`DELETE FROM "PersonalBudgetCategory" WHERE "userId" = $1 AND id = $2`, [E2E_USER.id, id]);
  });
});

function plannedGroup(page: Page, heading: string) {
  return page.getByRole("main").getByRole("region", { name: heading });
}
function plannedRow(page: Page, heading: string, name: string) {
  return plannedGroup(page, heading).getByRole("listitem").filter({ hasText: name });
}

test("adds a personal planned bill, counts it until paid, and keeps it off the household budget", async ({
  page,
}, testInfo) => {
  const category = await seedCategory();
  const name = `Dentist ${tag()}`;
  const main = page.getByRole("main");

  // --- Add the bill -------------------------------------------------------
  await page.goto("/dashboard/personal-budget?tab=manage");
  await main.getByRole("button", { name: "Add planned bill" }).click();
  const dialog = page.getByRole("dialog", { name: "Add planned bill" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Amount").fill("1200");
  await dialog.getByRole("combobox", { name: "Category" }).fill(category.name);
  await page.getByRole("option", { name: category.name, exact: true }).click();
  // Only the user pays a personal bill: nothing to split.
  await expect(dialog.getByRole("checkbox", { name: "Split this bill" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  const dueRow = plannedRow(page, "Due this month", name);
  await expect(dueRow).toBeVisible();
  await expect(dueRow).toContainText(/1[\s,.]?200/);
  if (testInfo.project.name.startsWith("mobile")) {
    await expectTouchTargets(page);
    await expectTargetsApart(plannedGroup(page, "Due this month"));
  }

  // --- It counts in Safe to spend and shows in the due strip ---------------
  await page.getByRole("tab", { name: "Overview" }).click();
  await main.getByText("How we got this number").click();
  const stillDue = main.getByText("Still due this month").locator("xpath=following-sibling::ul");
  await expect(stillDue.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  const dueStrip = main.locator('[data-slot="card"]').filter({ hasText: "Due this period" });
  const stripRow = dueStrip.getByText(name, { exact: true }).locator("xpath=ancestor::div[.//button][1]");
  await expect(stripRow.getByRole("button", { name: "Log payment" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // --- Only the user sees it: not on the household budget -------------------
  await page.goto("/dashboard/budget?tab=manage");
  await expect(main.getByRole("heading", { name: "Planned bills" })).toBeVisible();
  await expect(main.getByText(name)).toHaveCount(0);

  // --- Log its payment -----------------------------------------------------
  await page.goto("/dashboard/personal-budget?tab=manage");
  await plannedRow(page, "Due this month", name).getByRole("button", { name: "Log payment" }).click();
  const txDialog = page.getByRole("dialog", { name: "Add transaction" });
  await expect(txDialog).toBeVisible();
  await expect(txDialog.getByLabel("Amount", { exact: true })).toHaveValue("1200");
  await txDialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(txDialog).toBeHidden();
  await expect(page.getByText(`${name} marked as paid.`)).toBeVisible();

  await page.reload();
  const paidRow = plannedRow(page, "Paid", name);
  await expect(paidRow).toBeVisible();
  await expect(paidRow.getByRole("button", { name: "Log payment" })).toHaveCount(0);
  await expect(paidRow.getByRole("button", { name: `Delete ${name}` })).toHaveCount(0);
  await expect(plannedRow(page, "Due this month", name)).toHaveCount(0);

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(dueStrip.getByText(name, { exact: true })).toHaveCount(0);
});
