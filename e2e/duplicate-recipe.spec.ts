import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, openRowSheet } from "./ui";

// GAP-48: "Duplicate" in a recipe's sheet copies it as "<name> (copy)", opens
// the copy for editing and offers Undo. The spec seeds its own recipe (unique
// name, one ingredient) and removes it and any copy afterwards, so the shared
// seeded recipes stay untouched.
const t = en.mealPlanning;

let name: string;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  name = `Lasagne ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const id = `e2e-recipe-${E2E_WORKER}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name, instructions) VALUES ($1, $2, $3, 'Layer it')`, [
      id,
      E2E_HOUSEHOLD.id,
      name,
    ]);
    await client.query(
      `INSERT INTO "RecipeIngredient" (id, "recipeId", name, quantity, unit) VALUES ($1, $2, 'Lasagne sheets', 12, 'pcs')`,
      [`${id}-ing`, id],
    );
  } finally {
    await client.end();
  }
});

test.afterEach(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND name IN ($2, $3)`, [
      E2E_HOUSEHOLD.id,
      name,
      `${name} (copy)`,
    ]);
  } finally {
    await client.end();
  }
});

test("Duplicate opens the copy for editing and both recipes are there after a reload", async ({ page }) => {
  await page.goto("/dashboard/meal-planning?tab=recipes");
  await (await openRowSheet(page, name)).getByRole("button", { name: t.duplicateRecipe, exact: true }).click();

  const edit = page.getByRole("dialog", { name: t.editRecipeDialogTitle });
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel(t.recipeNameLabel, { exact: true })).toHaveValue(`${name} (copy)`);
  await expect(page.getByText(t.duplicateRecipeToast)).toBeVisible();

  await page.reload();
  await page.getByRole("searchbox", { name: /Search recipes/ }).fill(name);
  await expect(page.getByRole("main").getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1);
  const sheet = await openRowSheet(page, `${name} (copy)`);
  await expect(sheet.getByText("Lasagne sheets")).toBeVisible();
});

test("Undo on the toast removes the copy and leaves the original", async ({ page }) => {
  await page.goto("/dashboard/meal-planning?tab=recipes");
  await (await openRowSheet(page, name)).getByRole("button", { name: t.duplicateRecipe, exact: true }).click();
  await expect(page.getByRole("dialog", { name: t.editRecipeDialogTitle })).toBeVisible();

  await page.getByRole("button", { name: t.duplicateRecipeUndo, exact: true }).click();
  await expect(page.getByText(t.duplicateRecipeUndoneToast)).toBeVisible();

  await page.reload();
  await page.getByRole("searchbox", { name: /Search recipes/ }).fill(name);
  await expect(page.getByRole("main").getByText(name, { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByRole("main").getByText(`${name} (copy)`, { exact: true })).toHaveCount(0);
});
