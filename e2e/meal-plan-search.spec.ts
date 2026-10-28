import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow } from "./ui";

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
    const addMeal = page.getByRole("button", { name: /^Add (your first dinner|meal, )/ }).first();
    await expectHydrated(addMeal);
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
