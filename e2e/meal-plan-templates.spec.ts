import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow } from "./ui";

// GAP-52: save a week of meals as a named template, then plan an empty week
// from it. The household is shared by the desktop and mobile runs, so each
// project uses its own far-future source and target week, and the rows are
// cleaned up by id/name in E2E_HOUSEHOLD only.
const weeks = (project: string) =>
  project === "mobile"
    ? { source: "2031-05-12", target: "2031-05-19" }
    : { source: "2031-05-05", target: "2031-05-26" };

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a saved week can be stamped onto an empty week", async ({ page }, testInfo) => {
  const { source, target } = weeks(testInfo.project.name);
  const stamp = Date.now().toString(36);
  const templateName = `Basics ${stamp}`;
  const monday = `Pasta ${stamp}`;
  const wednesday = `Stew ${stamp}`;
  const planId = `e2e-gap52-plan-${E2E_WORKER}-${stamp}`;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)`, [
      planId,
      E2E_HOUSEHOLD.id,
      source,
    ]);
    for (const [i, [date, name]] of [
      [source, monday],
      ["2031-05-" + String(Number(source.slice(-2)) + 2).padStart(2, "0"), wednesday],
    ].entries()) {
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName", portions)
         VALUES ($1, $2, $3, 'DINNER', $4, 2)`,
        [`e2e-gap52-entry-${E2E_WORKER}-${stamp}-${i}`, planId, date, name],
      );
    }

    // Save the seeded week.
    await page.goto(`/dashboard/meal-planning?week=${source}`);
    const more = page.getByRole("button", { name: "More planner actions" });
    await expectHydrated(more);
    await more.click();
    await page.getByRole("menuitem", { name: "Save week as template" }).click();
    const saveDialog = page.getByRole("dialog", { name: "Save week as template" });
    await saveDialog.getByRole("textbox", { name: "Template name" }).fill(templateName);
    await saveDialog.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText(`Saved as template "${templateName}"`)).toBeVisible();

    // Nothing changes until the template is applied: the empty week stays
    // empty while the picker is open.
    await page.goto(`/dashboard/meal-planning?week=${target}`);
    const moreTarget = page.getByRole("button", { name: "More planner actions" });
    await expectHydrated(moreTarget);
    await moreTarget.click();
    await page.getByRole("menuitem", { name: "Plan from template" }).click();
    const picker = page.getByRole("dialog", { name: "Plan from template" });
    await expect(picker.getByText(templateName)).toBeVisible();
    await expect(picker.getByText("2 meals")).toBeVisible();
    if (testInfo.project.name === "mobile") await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("main").getByText(monday)).toHaveCount(0);

    await picker.getByRole("button", { name: `Plan this week from template "${templateName}"` }).click();
    await expect(page.getByText("Planned 2 meals from the template")).toBeVisible();
    await expect(page.getByRole("main").getByText(monday)).toBeVisible();
    await expect(page.getByRole("main").getByText(wednesday)).toBeVisible();

    // And it saved.
    await page.reload();
    await expect(page.getByRole("main").getByText(monday)).toBeVisible();
    await expect(page.getByRole("main").getByText(wednesday)).toBeVisible();
  } finally {
    await client.query(
      `DELETE FROM "MealPlanEntry" WHERE "mealPlanId" IN
         (SELECT id FROM "MealPlan" WHERE "householdId" = $1 AND "weekStartDate" = ANY($2::timestamp[]))`,
      [E2E_HOUSEHOLD.id, [source, target]],
    );
    await client.query(`DELETE FROM "MealPlan" WHERE "householdId" = $1 AND "weekStartDate" = ANY($2::timestamp[])`, [
      E2E_HOUSEHOLD.id,
      [source, target],
    ]);
    await client.query(`DELETE FROM "MealPlanTemplate" WHERE "householdId" = $1 AND name = $2`, [
      E2E_HOUSEHOLD.id,
      templateName,
    ]);
    await client.end();
  }
});
