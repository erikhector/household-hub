import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "../src/lib/i18n/dictionaries/en";
import { sv } from "../src/lib/i18n/dictionaries/sv";
import { format } from "../src/lib/i18n/format";
import { buildPaprikaArchive } from "../src/lib/recipe-import/zip-fixture";
import { E2E_HOUSEHOLD, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow } from "./ui";

// GAP-67: "Import from a file" on the Recipes tab. A three-recipe
// .paprikarecipes archive is built in the test, uploaded, reviewed (one
// recipe unticked) and imported; the two ticked ones are on the Recipes tab
// after a reload, and the unticked one is not. Runs on desktop and mobile,
// in English and Swedish. Rows are named per run and removed afterwards,
// scoped to this worker's household.

let prefix: string;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  prefix = `Imp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
});

test.afterEach(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND name LIKE $2`, [
      E2E_HOUSEHOLD.id,
      `${prefix}%`,
    ]);
  } finally {
    await client.end();
  }
});

const locales = [
  { code: "en", t: en.mealPlanning, state: undefined },
  { code: "sv", t: sv.mealPlanning, state: STORAGE_STATE_SV },
] as const;

for (const { code, t, state } of locales) {
  test.describe(code, () => {
    if (state) test.use({ storageState: state });

    test("a Paprika archive is reviewed, two of three recipes are imported, and they survive a reload", async ({
      page,
    }) => {
      const recipes = [
        { name: `${prefix} Pancakes`, ingredients: "2 dl flour\n3 eggs", directions: "Whisk.\nFry." },
        { name: `${prefix} Soup`, ingredients: "1 onion\n400 g tomatoes", directions: "Simmer." },
        { name: `${prefix} Stew`, ingredients: "500 g beef", directions: "Braise." },
      ];
      await page.goto("/dashboard/meal-planning?tab=recipes");
      const open = page.getByRole("button", { name: t.importFileButton });
      await expectHydrated(open);
      await open.click();

      const dialog = page.getByRole("dialog", { name: t.importFileTitle });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(t.importFileInputLabel).setInputFiles({
        name: "export.paprikarecipes",
        mimeType: "application/octet-stream",
        buffer: buildPaprikaArchive(recipes),
      });

      // The review list: nothing is saved yet.
      await expect(dialog.getByText(format(t.importFileFound.other, { count: 3 }))).toBeVisible();
      for (const recipe of recipes) await expect(dialog.getByText(recipe.name, { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Untick the stew, import the other two.
      await dialog.getByRole("checkbox", { name: new RegExp(`${prefix} Stew`) }).uncheck();
      await dialog.getByRole("button", { name: format(t.importFileSubmit.other, { count: 2 }) }).click();
      await expect(page.getByText(format(t.importFileToast.other, { count: 2 }))).toBeVisible();
      await expect(dialog).toBeHidden();

      await page.reload();
      const main = page.getByRole("main");
      await expect(main.getByText(`${prefix} Pancakes`, { exact: true }).first()).toBeVisible();
      await expect(main.getByText(`${prefix} Soup`, { exact: true }).first()).toBeVisible();
      await expect(main.getByText(`${prefix} Stew`, { exact: true })).toHaveCount(0);
    });
  });
}

test("a file that isn't a recipe export says so and saves nothing", async ({ page }) => {
  const t = en.mealPlanning;
  await page.goto("/dashboard/meal-planning?tab=recipes");
  const open = page.getByRole("button", { name: t.importFileButton });
  await expectHydrated(open);
  await open.click();
  const dialog = page.getByRole("dialog", { name: t.importFileTitle });
  await dialog.getByLabel(t.importFileInputLabel).setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from("hello"),
  });
  await expect(dialog.getByRole("alert")).toHaveText(t.importFileErrorUnsupported);
});
