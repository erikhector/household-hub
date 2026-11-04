import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { STORAGE_STATE, STORAGE_STATE_SV, E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  openRowSheet,
  waitForDialogHistory,
} from "./ui";

// GAP-71: the household's required diet tags (Household.requiredTags) are set
// as toggle chips in Household > Settings, and a planned recipe that lacks one
// shows a "Not vegetarian" badge, in words, on its week-plan entry and in the
// recipe sheet's Add to plan dialog. A warning only. Phone viewport only: the
// check is the entry row's room at 412 px. The household's tags are reset and
// the recipe removed afterwards, so the other specs in this worker see no
// requirement (and so no badges).
const DAY_MS = 24 * 60 * 60 * 1000;
const key = (day: Date) => day.toISOString().slice(0, 10);
const mondayOf = (day: Date) => new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);

async function withClient<T>(fn: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

for (const [locale, storageState, dict, badge] of [
  ["en", STORAGE_STATE, en, "Not vegetarian"],
  ["sv", STORAGE_STATE_SV, sv, "Inte vegetariskt"],
] as const) {
  test.describe(`required diet (${locale})`, () => {
    test.use({ storageState });

    let name: string;
    let recipeId: string;

    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      name = `Nusskaka ${suffix}`;
      recipeId = `e2e-recipe-diet-${E2E_WORKER}-${locale}-${suffix}`;
      await withClient((client) =>
        client.query(`INSERT INTO "Recipe" (id, "householdId", name, instructions) VALUES ($1, $2, $3, 'Bake')`, [
          recipeId,
          E2E_HOUSEHOLD.id,
          name,
        ]),
      );
    });

    test.afterEach(async () => {
      await withClient(async (client) => {
        await client.query(`UPDATE "Household" SET "requiredTags" = '{}' WHERE id = $1`, [E2E_HOUSEHOLD.id]);
        await client.query(
          `DELETE FROM "MealPlanEntry" entry USING "MealPlan" plan
           WHERE entry."mealPlanId" = plan.id AND plan."householdId" = $1 AND entry."recipeId" = $2`,
          [E2E_HOUSEHOLD.id, recipeId],
        );
        await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [recipeId, E2E_HOUSEHOLD.id]);
      });
    });

    test("requiring Vegetarian flags a planned untagged recipe in words", async ({ page }) => {
      const mp = dict.mealPlanning;
      const day = new Date(Date.now() + (12000 + Math.floor(Math.random() * 500)) * DAY_MS);
      const dialogName = mp.addToPlanDialogTitle.replace("{recipe}", name);

      // Without a requirement nothing is flagged.
      await page.goto("/dashboard/meal-planning?tab=recipes");
      await (await openRowSheet(page, name)).getByRole("button", { name: mp.addToPlanButton, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: dialogName });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(badge)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await waitForDialogHistory(page);

      // Household > Settings: tick Vegetarian, and it survives a reload.
      await page.goto("/dashboard/household?tab=settings");
      const groupName = dict.household.requiredDiet.groupLabel;
      const chip = page.getByRole("group", { name: groupName }).getByRole("button", {
        name: mp.recipeTags.vegetarian,
        exact: true,
      });
      await expectHydrated(chip);
      await chip.click();
      await expect(page.getByText(dict.household.requiredDiet.savedToast)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.reload();
      await expect(
        page.getByRole("group", { name: groupName }).getByRole("button", { name: mp.recipeTags.vegetarian, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");

      // Add to plan warns before saving, then the entry carries the badge.
      await page.goto("/dashboard/meal-planning?tab=recipes");
      await (await openRowSheet(page, name)).getByRole("button", { name: mp.addToPlanButton, exact: true }).click();
      const planDialog = page.getByRole("dialog", { name: dialogName });
      await expect(planDialog.getByText(badge)).toBeVisible();
      await planDialog.getByLabel(mp.dateLabel).fill(key(day));
      await planDialog.getByRole("button", { name: mp.addToPlanSubmit, exact: true }).click();
      await waitForDialogHistory(page);

      await page.goto(`/dashboard/meal-planning?week=${key(mondayOf(day))}`);
      const entry = page.getByRole("main").getByRole("button", { name: new RegExp(name) }).filter({ visible: true });
      await expect(entry).toHaveCount(1);
      await expect(entry.getByText(badge)).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
}
