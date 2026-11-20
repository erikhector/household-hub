import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { withDb } from "./db";
import { E2E_HOUSEHOLD, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  expectRouterPatched,
  openRowSheet,
  waitForDialogHistory,
} from "./ui";

// GAP-81: a planned meal carries a short note. Added in the meal's edit
// form, it shows as one cut-short line on the day and in full in the meal's
// sheet, survives a reload, and an emptied field clears it. The dinner is
// written straight to Postgres in a far-future week of its own (a Monday per
// project and locale), so nothing else in the worker's household is on the
// page.
const WEEKS = {
  desktop: { en: "2033-03-07", sv: "2033-03-14" },
  mobile: { en: "2033-03-21", sv: "2033-03-28" },
} as const;

// Long enough to need cutting on a 412 px day card, and with Swedish letters.
const NOTE = "Thaw the chicken the night before, Åsa cooks, and double it so there is enough for the lunch boxes";

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.afterEach(async ({}, testInfo) => {
  const like = `e2e-gap81-plan-${E2E_WORKER}-%-${testInfo.project.name}`;
  await withDb(async (client) => {
    await client.query(
      `DELETE FROM "MealPlanEntry" entry USING "MealPlan" plan
       WHERE entry."mealPlanId" = plan.id AND plan."householdId" = $1 AND plan.id LIKE $2`,
      [E2E_HOUSEHOLD.id, like],
    );
    await client.query(`DELETE FROM "MealPlan" WHERE id LIKE $1 AND "householdId" = $2`, [like, E2E_HOUSEHOLD.id]);
  });
});

for (const [locale, storageState, t] of [
  ["en", STORAGE_STATE, en.mealPlanning],
  ["sv", STORAGE_STATE_SV, sv.mealPlanning],
] as const) {
  test.describe(`meal note (${locale})`, () => {
    test.use({ storageState });

    test("a note added to a planned dinner shows on the day and in its sheet, survives a reload, and can be cleared", async ({
      page,
    }, testInfo) => {
      const project = testInfo.project.name === "mobile" ? "mobile" : "desktop";
      const week = WEEKS[project][locale];
      const planId = `e2e-gap81-plan-${E2E_WORKER}-${locale}-${testInfo.project.name}`;
      const entryId = `${planId}-entry`;
      const meal = `Note stew ${E2E_WORKER} ${Math.random().toString(36).slice(2, 8)}`;
      // The Wednesday of that week.
      const day = new Date(new Date(`${week}T00:00:00.000Z`).getTime() + 2 * 24 * 60 * 60 * 1000);

      await withDb(async (client) => {
        await client.query(`DELETE FROM "MealPlanEntry" WHERE "mealPlanId" = $1`, [planId]);
        await client.query(`DELETE FROM "MealPlan" WHERE id = $1 AND "householdId" = $2`, [planId, E2E_HOUSEHOLD.id]);
        await client.query(`INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)`, [
          planId,
          E2E_HOUSEHOLD.id,
          week,
        ]);
        await client.query(
          `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName", portions)
           VALUES ($1, $2, $3, 'DINNER', $4, 2)`,
          [entryId, planId, day, meal],
        );
      });
      const storedNote = () =>
        withDb(async (client) => {
          const { rows } = await client.query(`SELECT note FROM "MealPlanEntry" WHERE id = $1`, [entryId]);
          return rows[0].note as string | null;
        });

      const main = page.getByRole("main");
      const row = main.getByRole("button").filter({ hasText: meal }).filter({ visible: true });
      const noteOnDay = main.getByText(NOTE, { exact: true }).filter({ visible: true });
      const editDialog = page.getByRole("dialog", { name: t.editMealDialogTitle, exact: true });
      const noteField = editDialog.getByRole("textbox", { name: t.mealNoteLabel, exact: true });

      // The meal's sheet, then its edit form.
      async function openEdit() {
        await expectHydrated(row);
        await expectRouterPatched(page);
        const sheet = await openRowSheet(page, meal);
        await sheet.getByRole("button", { name: t.editMealAriaLabel, exact: true }).click();
        await expect(noteField).toBeVisible();
      }

      await page.goto(`/dashboard/meal-planning?week=${week}`);
      await expect(noteOnDay).toHaveCount(0);

      // Add it, with stray spaces the server trims.
      await openEdit();
      await expect(noteField).toHaveValue("");
      await noteField.fill(`  ${NOTE}  `);
      await editDialog.getByRole("button", { name: t.save, exact: true }).click();
      await expect(noteOnDay).toBeVisible();
      await waitForDialogHistory(page);
      expect(await storedNote()).toBe(NOTE);

      // It saved: after a reload it's on the day, cut to one line there...
      await page.reload();
      await expect(noteOnDay).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const line = await noteOnDay.evaluate((el) => ({
        clipped: el.scrollWidth > el.clientWidth,
        lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
      }));
      expect(line.lines).toBe(1);
      if (project === "mobile") expect(line.clipped).toBe(true);

      // ...and in full in the meal's sheet, with nothing clipped.
      await expectHydrated(row);
      await expectRouterPatched(page);
      const sheet = await openRowSheet(page, meal);
      const noteInSheet = sheet.getByText(NOTE);
      await expect(noteInSheet).toBeVisible();
      const fit = await noteInSheet.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
      expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight);

      // The edit form has it too; emptying the field clears it.
      await sheet.getByRole("button", { name: t.editMealAriaLabel, exact: true }).click();
      await expect(noteField).toHaveValue(NOTE);
      await noteField.fill("");
      await editDialog.getByRole("button", { name: t.save, exact: true }).click();
      await expect(noteOnDay).toHaveCount(0);
      await waitForDialogHistory(page);
      expect(await storedNote()).toBeNull();

      await page.reload();
      await expect(row).toBeVisible();
      await expect(noteOnDay).toHaveCount(0);
    });
  });
}
