import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-98: the recipe form follows the order a recipe is written in (name and
// servings, ingredients, then method and tags), says what an instruction line
// becomes, and its controls are labelled and finger-sized.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the recipe form is in recipe order, labelled, with 44 px tag chips", async ({ page }) => {
  await page.goto("/dashboard/meal-planning");
  await page.getByRole("tab", { name: "Recipes" }).click();
  await page.getByRole("button", { name: "New recipe" }).click();
  const dialog = page.getByRole("dialog", { name: "New recipe" });
  await expect(dialog).toBeVisible();

  // Position in the document, independent of how far the sheet is scrolled.
  const pageTop = (locator: ReturnType<typeof dialog.locator>) =>
    locator.evaluate((el) => el.getBoundingClientRect().top - (el.closest("[data-slot=dialog-body]")?.getBoundingClientRect().top ?? 0) + (el.closest("[data-slot=dialog-body]")?.scrollTop ?? 0));
  const servings = await pageTop(dialog.getByLabel("Portions"));
  const ingredients = await pageTop(dialog.getByText("Ingredients", { exact: true }));
  const instructions = await pageTop(dialog.getByLabel("Instructions"));
  const tags = await pageTop(dialog.getByText("Tags", { exact: true }));
  expect(servings).toBeLessThan(ingredients);
  expect(ingredients).toBeLessThan(instructions);
  expect(instructions).toBeLessThan(tags);

  await expect(dialog.getByText("One step per line — each becomes a step in Cook mode")).toBeVisible();
  await expect(dialog.getByLabel("Instructions")).toHaveAccessibleDescription(/One step per line/);

  await expect(dialog.getByRole("spinbutton", { name: "Quantity" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Unit", exact: true })).toBeVisible();
  await expect(dialog.getByText(/inventory decrement/)).toHaveCount(0);

  const chip = dialog.getByRole("button", { name: "Vegetarian" });
  await chip.scrollIntoViewIfNeeded();
  const box = (await chip.boundingBox())!;
  const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches || innerWidth < 640);
  if (touch) expect(box.height).toBeGreaterThanOrEqual(43.5);
  expect(await chip.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
});
