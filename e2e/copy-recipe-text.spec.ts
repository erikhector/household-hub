import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice } from "./ui";

// GAP-43: "Copy as text" on a recipe row puts the formatted recipe on the
// clipboard and confirms with a toast. Nothing is saved, so no cleanup. The
// seeded "Pancakes" recipe has two steps and one ingredient (e2e/seed.ts).
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
});

test("Copy as text puts the recipe on the clipboard and shows a toast", async ({ page }) => {
  const t = en.mealPlanning;
  await page.goto("/dashboard/meal-planning?tab=recipes");
  await page.getByRole("searchbox", { name: /Search recipes/ }).fill("Pancakes");
  // The search filters after a render: click only once a single row is left.
  const copy = page.getByRole("button", { name: t.copyRecipeText, exact: true });
  await expect(copy).toHaveCount(1);
  await copy.click();

  await expect(page.getByText(t.copyRecipeTextToast)).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("Pancakes");
  expect(text).toContain(`${t.ingredientsLabel}\n- 3 dl Wheat flour`);
  expect(text).toContain(`${t.instructionsLabel}\n1. Whisk the batter\n2. Fry the pancakes`);
});

test("a recipe without instructions still copies, without an instructions section", async ({ page }) => {
  const t = en.mealPlanning;
  await page.goto("/dashboard/meal-planning?tab=recipes");
  await page.getByRole("searchbox", { name: /Search recipes/ }).fill("Cinnamon buns");
  // The search filters after a render: click only once a single row is left.
  const copy = page.getByRole("button", { name: t.copyRecipeText, exact: true });
  await expect(copy).toHaveCount(1);
  await copy.click();

  await expect(page.getByText(t.copyRecipeTextToast)).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("- 750 g Wheat flour");
  expect(text).not.toContain(t.instructionsLabel);
});
