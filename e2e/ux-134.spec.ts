import { expect, test } from "@playwright/test";
import { budgetTag, insertHouseholdCategory, withDb } from "./budget-seed";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, waitForDialogHistory } from "./ui";

// UX-134: a budget month that starts on payday. With the start day set to
// 25, "October" is 25 Sep to 24 Oct: the month bar names those dates, a
// recurring item due on the 28th is logged on 28 Sep and counts in October
// (not September), and it leaves October's Due list. A far-away year keeps
// the dates the same whenever the suite runs.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// The worker's household is shared with other specs, which expect calendar
// months, so the start day goes back to 1 whatever happens.
test.afterEach(async () => {
  await withDb((client) =>
    client.query(`UPDATE "Household" SET "budgetMonthStartDay" = 1 WHERE id = $1`, [E2E_HOUSEHOLD.id]),
  );
});

test("a month starting on the 25th counts an early payment in the month it is due", async ({ page }) => {
  const tag = budgetTag();
  const name = `Rent ${tag}`;
  const categoryId = `e2e-u134-cat-${tag}`;
  const templateId = `e2e-u134-tpl-${tag}`;
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: categoryId, name: `Housing ${tag}` });
    await client.query(
      `INSERT INTO "RecurringTemplate" (id, "householdId", "categoryId", name, amount, type, frequency, "dayOfMonth")
       VALUES ($1, $2, $3, $4, 12500, 'EXPENSE', 'MONTHLY', 28)`,
      [templateId, E2E_HOUSEHOLD.id, categoryId, name],
    );
  });

  // --- The owner sets the start day on the Household page -------------------
  await page.goto("/dashboard/household");
  const startDay = page.getByRole("combobox", { name: "Budget month starts on day" });
  await expect(startDay).toBeVisible();
  await startDay.click();
  await page.getByRole("option", { name: "25", exact: true }).click();
  await expect(page.getByText("Budget month updated")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Budget month starts on day" })).toContainText("25");

  // --- October is 25 Sep to 24 Oct, and the rent is due in it ---------------
  await page.goto("/dashboard/budget?month=2031-10");
  const main = page.getByRole("main");
  await expect(main.getByText("October 2031")).toBeVisible();
  await expect(main.getByText("Sep 25 – Oct 24")).toBeVisible();
  const row = main.getByRole("button", { name: `More actions for ${name}` }).locator("xpath=..");
  await expect(row).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // --- Logging it starts on its due day, 28 September -----------------------
  await row.getByRole("button", { name: "Log", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Date")).toHaveValue("2031-09-28");
  await dialog.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(dialog).toBeHidden();
  await waitForDialogHistory(page);

  // --- ...so October is settled, and September (25 Aug to 24 Sep) is not ----
  await page.reload();
  await expect(main.getByRole("button", { name: `More actions for ${name}` })).toHaveCount(0);
  await page.goto("/dashboard/budget?month=2031-10&tab=transactions");
  await expect(main.getByText(`Housing ${tag}`).filter({ visible: true }).first()).toBeVisible();
  await page.goto("/dashboard/budget?month=2031-09&tab=transactions");
  await expect(main.getByText("Aug 25 – Sep 24")).toBeVisible();
  await expect(main.getByText(`Housing ${tag}`).filter({ visible: true })).toHaveCount(0);

  await withDb(async (client) => {
    await client.query(`DELETE FROM "Transaction" WHERE "recurringTemplateId" = $1`, [templateId]);
    await client.query(`DELETE FROM "RecurringTemplate" WHERE id = $1`, [templateId]);
    await client.query(`DELETE FROM "BudgetCategory" WHERE id = $1`, [categoryId]);
  });
});

test("calendar months show no period dates", async ({ page }) => {
  await page.goto("/dashboard/budget?month=2031-10");
  const main = page.getByRole("main");
  await expect(main.getByText("October 2031")).toBeVisible();
  await expect(main.getByText("Sep 25 – Oct 24")).toHaveCount(0);
});
