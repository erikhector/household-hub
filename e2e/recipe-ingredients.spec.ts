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

  // Back (the text button in the footer; the header has an arrow too)
  // returns to the recipe fields with nothing saved yet.
  await review.getByRole("button", { name: "Back" }).last().click();
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

// A name no pantry item resembles, so the row gets no suggestion. Random
// letters rather than a shared prefix, since the desktop and mobile runs
// share one household and a common prefix would fuzzily match the item the
// other run created.
const nonsenseName = () =>
  Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

test("the review step creates a new item, blocks an incomplete row, and folds away confident matches", async ({
  page,
}) => {
  const recipeName = unique("Stew");
  const spice = nonsenseName();
  const dialog = await openNewRecipe(page, recipeName);
  await fillIngredient(page, "Olive oil", "1", "dl");
  await dialog.getByRole("button", { name: "Add ingredient" }).click();
  await dialog.getByPlaceholder("Ingredient").nth(1).fill(spice);
  await dialog.getByPlaceholder("Qty").nth(1).fill("1");
  await dialog.getByPlaceholder("Unit").nth(1).fill("krm");
  await dialog.getByRole("button", { name: "Create recipe" }).click();

  const review = page.getByRole("dialog", { name: "Match ingredients" });
  await expect(review.getByRole("heading", { name: "Match ingredients" })).toBeFocused();

  // The confident "Olive oil" row is folded into the summary.
  const oliveOil = review.getByRole("group", { name: "1 dl Olive oil" });
  await expect(oliveOil).toHaveCount(0);
  await review.getByRole("button", { name: "Show" }).click();
  await expect(oliveOil).toBeVisible();
  await review.getByRole("button", { name: "Hide" }).click();
  await expect(oliveOil).toHaveCount(0);

  // No match, so it defaults to Create new with a pantry-friendly unit and
  // a neutral note (not a warning about our own default).
  const row = review.getByRole("group", { name: `1 krm ${spice}` });
  await expect(row.getByText("Nothing close in your pantry, so this becomes a new item.")).toBeVisible();
  await expect(row.getByRole("button", { name: "Create new" })).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByRole("textbox", { name: "Counted in" })).toHaveValue("pcs");
  await expect(row.getByText("The pantry will count it in pcs. Change it if you buy it differently.")).toBeVisible();

  // A new item needs a name: Save is blocked, and focus lands on the field.
  const newName = row.getByRole("textbox", { name: "New item name" });
  await newName.fill("");
  await review.getByRole("button", { name: "Create recipe" }).click();
  await expect(review.getByRole("alert").filter({ hasText: "1 ingredient still needs a choice." })).toBeVisible();
  await expect(newName).toBeFocused();
  await expect(newName).toHaveAttribute("aria-invalid", "true");

  const itemName = `${spice} jar`;
  await newName.fill(itemName);
  const category = row.getByRole("combobox", { name: "Category" });
  await category.fill("Spices");
  // Leave the field so its suggestion popup closes.
  await category.press("Tab");

  // Nothing in the step scrolls sideways.
  const form = review.locator("form:not([hidden])");
  const { scrollWidth, clientWidth } = await form.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

  await review.getByRole("button", { name: "Create recipe" }).click();
  await expect(page.getByText("Saved · 2 ingredients linked to your pantry")).toBeVisible();

  // The new item exists, under the chosen name.
  await page.goto("/dashboard/inventory");
  await page.getByPlaceholder("Search by name…").fill(spice);
  await expect(page.getByText(itemName, { exact: true }).filter({ visible: true }).first()).toBeVisible();
});
