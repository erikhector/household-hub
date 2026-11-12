import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, expectRouterPatched } from "./ui";

// GAP-59: search the whole meal plan from the planner, not week by week.
const DAY_MS = 24 * 60 * 60 * 1000;
const key = (day: Date) => day.toISOString().slice(0, 10);

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("search finds a custom meal planned two weeks ahead and links to its week", async ({ page }, testInfo) => {
  const name = `Zebrapie ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS);
  const targetWeek = key(new Date(monday.getTime() + 14 * DAY_MS));

  try {
    // Plan it two weeks ahead, through the UI.
    await page.goto(`/dashboard/meal-planning?week=${targetWeek}`);
    const addMeal = page.getByRole("button", { name: /^Add (first dinner|meal, )/ }).first();
    await expectHydrated(addMeal);
    await expectRouterPatched(page);
    await addMeal.click();
    const dialog = page.getByRole("dialog", { name: /^Add \w+ · \w+ \d+$/ });
    await dialog.getByRole("combobox", { name: "Recipe" }).click();
    await page.getByRole("option", { name: "Custom meal…" }).click();
    await dialog.getByRole("textbox", { name: "Meal name" }).fill(name);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("main").getByText(name)).toBeVisible();

    // Back on this week, find it by search.
    await page.goto("/dashboard/meal-planning");
    const field = page.getByRole("searchbox", { name: "Search the meal plan" });
    await expect(field).toBeVisible();
    // M3: a 44 px target on a phone.
    if (testInfo.project.name === "mobile") {
      expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // One character is not enough: nothing is asked or listed.
    await field.fill(name.slice(0, 1));
    await expect(page.getByRole("list", { name: "Planned meals matching your search" })).toHaveCount(0);
    await expect(page.getByText("Nothing planned matches that.")).toHaveCount(0);

    // Case-insensitive, from the middle of the name.
    await field.fill(name.slice(1, 8).toUpperCase());
    // "Mon, Nov 2 · Dinner · <name>": the date is in the viewer's language.
    const hit = page.getByRole("link", { name: new RegExp(`^[^·]+ · \\w+ · ${name}$`) });
    await expect(hit).toBeVisible();
    if (testInfo.project.name === "mobile") {
      expect((await hit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectNoHorizontalOverflow(page);
    }

    await hit.click();
    await expect(page).toHaveURL(new RegExp(`week=${targetWeek}`));
    await expect(page.getByRole("main").getByText(name, { exact: true }).first()).toBeVisible();

    // Nothing planned matches: said, not silent.
    await page.getByRole("searchbox", { name: "Search the meal plan" }).fill("qqqqzzzz");
    await expect(page.getByText("Nothing planned matches that.")).toBeVisible();
  } finally {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `DELETE FROM "MealPlanEntry" WHERE "freeformName" = $1
           AND "mealPlanId" IN (SELECT id FROM "MealPlan" WHERE "householdId" = $2)`,
        [name, E2E_HOUSEHOLD.id],
      );
    } finally {
      await client.end();
    }
  }
});

// GAP-79: the search also finds a planned recipe by one of its ingredients,
// and says which one when the recipe's name didn't match.
for (const locale of ["en", "sv"] as const) {
  test.describe(`ingredient search (${locale})`, () => {
    if (locale === "sv") test.use({ storageState: STORAGE_STATE_SV });
    const w = locale === "en" ? { field: "Search the meal plan", ingredient: "Ingredient" } : { field: "Sök i måltidsplanen", ingredient: "Ingrediens" };

    test("a recipe planned under another title is found by its ingredient and the link opens its week", async ({ page }) => {
      const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const suffix = `${E2E_WORKER}-${tag}`;
      const title = `Traybake ${tag}`;
      const ingredient = `Laxfile${tag}`;
      const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
      const day = new Date(today.getTime() + (30 + Math.floor(Math.random() * 200)) * DAY_MS);
      const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3)`, [`e2e-recipe-${suffix}`, E2E_HOUSEHOLD.id, title]);
        await client.query(
          `INSERT INTO "RecipeIngredient" (id, "recipeId", name, quantity, unit) VALUES ($1, $2, $3, 400, 'g')`,
          [`e2e-ing-${suffix}`, `e2e-recipe-${suffix}`, ingredient],
        );
        await client.query(
          `INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)
           ON CONFLICT ("householdId", "weekStartDate") DO NOTHING`,
          [`e2e-plan-${suffix}`, E2E_HOUSEHOLD.id, monday],
        );
        await client.query(
          `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "recipeId")
           SELECT $1, plan.id, $2, 'DINNER', $3 FROM "MealPlan" plan WHERE plan."householdId" = $4 AND plan."weekStartDate" = $5`,
          [`e2e-entry-${suffix}`, day, `e2e-recipe-${suffix}`, E2E_HOUSEHOLD.id, monday],
        );

        await page.goto("/dashboard/meal-planning");
        const field = page.getByRole("searchbox", { name: w.field });
        await expectHydrated(field);
        await field.fill(ingredient.toUpperCase());
        const hit = page.getByRole("link", { name: new RegExp(`${title}.*${w.ingredient}: ${ingredient}$`) });
        await expect(hit).toBeVisible();
        expect((await hit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expectNoHorizontalOverflow(page);

        // The title matches too: no second line.
        await field.fill(title);
        await expect(page.getByRole("link", { name: new RegExp(`${title}$`) })).toBeVisible();

        await field.fill(ingredient);
        await hit.click();
        await expect(page).toHaveURL(new RegExp(`week=${monday.toISOString().slice(0, 10)}`));
        await expect(page.getByRole("main").getByText(title).first()).toBeVisible();
      } finally {
        try {
          await client.query(`DELETE FROM "MealPlanEntry" WHERE id = $1`, [`e2e-entry-${suffix}`]);
          await client.query(`DELETE FROM "Recipe" WHERE id = $1 AND "householdId" = $2`, [`e2e-recipe-${suffix}`, E2E_HOUSEHOLD.id]);
        } finally {
          await client.end();
        }
      }
    });
  });
}
