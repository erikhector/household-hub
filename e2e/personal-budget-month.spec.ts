import { expect, test } from "@playwright/test";
import { budgetTag, insertPersonalCategory, withDb } from "./budget-seed";
import { E2E_USER } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, waitForDialogHistory } from "./ui";

// The Personal Budget's own budget month start day (UX-134's setting, for the
// user's personal budget). With it set to 25, the personal "October" is 25
// Sep to 24 Oct: the month bar names those dates, a recurring item due on the
// 28th is logged on 28 Sep and counts in October, and it leaves October's
// Due list. The household budget keeps its own (calendar) months. A far-away
// year keeps the dates the same whenever the suite runs.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

// The worker's user is shared with other specs, which expect calendar
// months, so the start day goes back to 1 whatever happens.
test.afterEach(async () => {
  await withDb((client) =>
    client.query(`UPDATE "User" SET "personalBudgetMonthStartDay" = 1 WHERE id = $1`, [E2E_USER.id]),
  );
});

test("a personal month starting on the 25th counts an early payment in the month it is due", async ({ page }) => {
  const tag = budgetTag();
  const name = `Gym ${tag}`;
  const categoryId = `e2e-pbm-cat-${tag}`;
  const templateId = `e2e-pbm-tpl-${tag}`;
  await withDb(async (client) => {
    await insertPersonalCategory(client, { id: categoryId, name: `Fitness ${tag}` });
    await client.query(
      `INSERT INTO "PersonalRecurringTemplate" (id, "userId", "categoryId", name, amount, type, frequency, "dayOfMonth")
       VALUES ($1, $2, $3, $4, 450, 'EXPENSE', 'MONTHLY', 28)`,
      [templateId, E2E_USER.id, categoryId, name],
    );
  });

  // --- The user sets the start day on the Manage tab ------------------------
  await page.goto("/dashboard/personal-budget?tab=manage");
  const startDay = page.getByRole("combobox", { name: "Budget month starts on day" });
  await expect(startDay).toBeVisible();
  await startDay.click();
  await page.getByRole("option", { name: "25", exact: true }).click();
  await expect(page.getByText("Budget month updated")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Budget month starts on day" })).toContainText("25");
  await expectNoHorizontalOverflow(page);

  // --- October is 25 Sep to 24 Oct, and the gym is due in it ----------------
  await page.goto("/dashboard/personal-budget?month=2031-10");
  const main = page.getByRole("main");
  await expect(main.getByText("October 2031")).toBeVisible();
  await expect(main.getByText("Sep 25 – Oct 24")).toBeVisible();
  const row = main.getByRole("button", { name: `More actions for ${name}` }).locator("xpath=..");
  await expect(row).toBeVisible();

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
  await page.goto("/dashboard/personal-budget?month=2031-10&tab=transactions");
  await expect(main.getByText(`Fitness ${tag}`).filter({ visible: true }).first()).toBeVisible();
  await page.goto("/dashboard/personal-budget?month=2031-09&tab=transactions");
  await expect(main.getByText("Aug 25 – Sep 24")).toBeVisible();
  await expect(main.getByText(`Fitness ${tag}`).filter({ visible: true })).toHaveCount(0);

  // --- The household budget keeps its own calendar months -------------------
  await page.goto("/dashboard/budget?month=2031-10");
  await expect(main.getByText("October 2031")).toBeVisible();
  await expect(main.getByText("Sep 25 – Oct 24")).toHaveCount(0);

  await withDb(async (client) => {
    await client.query(`DELETE FROM "PersonalTransaction" WHERE "recurringTemplateId" = $1`, [templateId]);
    await client.query(`DELETE FROM "PersonalRecurringTemplate" WHERE id = $1`, [templateId]);
    await client.query(`DELETE FROM "PersonalBudgetCategory" WHERE id = $1`, [categoryId]);
  });
});
