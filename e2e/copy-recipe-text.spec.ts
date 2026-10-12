import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice } from "./ui";

// GAP-43: "Copy as text" on a recipe row puts the formatted recipe on the
// clipboard and confirms with a toast. Nothing is saved, so no cleanup. The
// seeded "Pancakes" recipe has two steps and one ingredient (e2e/seed.ts).
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
});

// Other specs leave recipes beside the seeded ones, so pick the row by exact
// name rather than relying on there being one "Copy as text" button.
function rowOf(page: Page, recipeName: string) {
  return page
    .locator("div")
    .filter({ has: page.getByText(recipeName, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: en.mealPlanning.editAriaLabel }) })
    .last();
}

test("Copy as text puts the recipe on the clipboard and shows a toast", async ({ page }) => {
  const t = en.mealPlanning;
  await page.goto("/dashboard/meal-planning?tab=recipes");
  await rowOf(page, "Pancakes").getByRole("button", { name: t.copyRecipeText, exact: true }).click();

  await expect(page.getByText(t.copyRecipeTextToast)).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("Pancakes");
  expect(text).toContain(`${t.ingredientsLabel}\n- 3 dl Wheat flour`);
  expect(text).toContain(`${t.instructionsLabel}\n1. Whisk the batter\n2. Fry the pancakes`);
});

test("a recipe without instructions still copies, without an instructions section", async ({ page }) => {
  const t = en.mealPlanning;
  await page.goto("/dashboard/meal-planning?tab=recipes");
  await rowOf(page, "Cinnamon buns").getByRole("button", { name: t.copyRecipeText, exact: true }).click();

  await expect(page.getByText(t.copyRecipeTextToast)).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("- 750 g Wheat flour");
  expect(text).not.toContain(t.instructionsLabel);
});
