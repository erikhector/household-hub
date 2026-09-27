import { expect, test, type Page } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// MATCH-1: saving a recipe no longer creates inventory items behind the
// user's back. Rows the matcher is sure about save straight away; anything
// else goes through the dialog's "Match ingredients" step first. Relies on
// the "Tomatoes" and "Olive oil" pantry items seeded in e2e/seed.ts.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function openNewRecipe(page: Page, name: string) {
  await page.goto("/dashboard/meal-planning");
  await page.getByRole("tab", { name: "Recipes" }).click();
  await page.getByRole("button", { name: "New recipe" }).click();
  const dialog = page.getByRole("dialog", { name: "New recipe" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  return dialog;
}

async function fillIngredient(page: Page, name: string, quantity: string, unit: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Ingredient").fill(name);
  // Leave the name field so its suggestion list closes.
  await dialog.getByPlaceholder("Qty").fill(quantity);
  await dialog.getByPlaceholder("Unit").fill(unit);
}

test("a recipe whose ingredients all match saves without a review step", async ({ page }) => {
  const recipeName = unique("Salad");
  const dialog = await openNewRecipe(page, recipeName);
  await fillIngredient(page, "Olive oil", "2", "dl");
  await dialog.getByRole("button", { name: "Create recipe" }).click();

  await expect(page.getByText("Saved · 1 ingredient linked to your pantry")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Listed on the Recipes tab (and possibly in a suggestion block too).
  await expect(page.getByText(recipeName, { exact: true }).first()).toBeVisible();
});

test("an uncertain ingredient is reviewed, linked to the suggestion, and never becomes a new item", async ({
  page,
}) => {
  const recipeName = unique("Tomato soup");
  const dialog = await openNewRecipe(page, recipeName);
  await fillIngredient(page, "Tomater", "4", "pcs");
  await dialog.getByRole("button", { name: "Create recipe" }).click();

  // Step 2: the Swedish "Tomater" isn't a confident match for "Tomatoes",
  // so it's pre-selected but left open for a look.
  const review = page.getByRole("dialog", { name: "Match ingredients" });
  await expect(review).toBeVisible();
  const row = review.getByRole("group", { name: "4 pcs Tomater" });
  await expect(row.getByRole("combobox", { name: "Pantry item for Tomater" })).toHaveValue("Tomatoes · Produce");
  await expect(row.getByRole("button", { name: "Use existing" })).toHaveAttribute("aria-pressed", "true");

  // Back returns to the recipe fields with nothing saved yet.
  await review.getByRole("button", { name: "Back" }).click();
  const recipeStep = page.getByRole("dialog", { name: "New recipe" });
  await expect(recipeStep.getByRole("button", { name: "Next: match ingredients" })).toBeVisible();
  await recipeStep.getByRole("button", { name: "Next: match ingredients" }).click();
  await review.getByRole("button", { name: "Create recipe" }).click();

  await expect(page.getByText("Saved · 1 ingredient linked to your pantry")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // After a reload the link is kept: editing the recipe and saving again
  // doesn't ask about "Tomater" a second time.
  await page.reload();
  await page.getByRole("tab", { name: "Recipes" }).click();
  const recipeRow = page
    .locator("div")
    .filter({ has: page.getByText(recipeName, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Edit recipe" }) })
    .last();
  await recipeRow.getByRole("button", { name: "Edit recipe" }).click();
  await page.getByRole("dialog", { name: "Edit recipe" }).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // No phantom "Tomater" item appeared in the pantry.
  await page.goto("/dashboard/inventory");
  await page.getByPlaceholder("Search by name…").fill("Tomat");
  // Desktop shows a table and phones show cards, so only one is visible.
  await expect(page.getByText("Tomatoes", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Tomater", { exact: true })).toHaveCount(0);
});
