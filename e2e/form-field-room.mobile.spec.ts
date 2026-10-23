import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { dismissCookieNotice, openRecipesTab } from "./ui";

// UX-10 follow-up (DESIGN.md M1): on a 412 px phone, a combobox squeezed into
// a two- or three-column row lost its text to its own 44 px buttons — the
// add-item unit field had 5 px left and "pcs" showed as "p". UX-10 fixed one
// field with a fixed width; this checks every combobox in the dialogs below
// instead, so a new side-by-side layout fails here rather than on a phone.
// Plain inputs have no buttons eating their width, so they're left out.
test.skip(({ isMobile }) => !isMobile, "phone layout rule: desktop rows have room");

// Fits "Frukt och grönt" (~115 px at 16 px) with a little to spare.
const MIN_TEXT_PX = 120;

async function expectComboboxesHaveRoom(dialog: Locator) {
  const fields = await dialog
    .locator("input[role=combobox]")
    .evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().width > 0 && !el.closest("[aria-hidden=true]"))
        .map((el) => {
          const style = getComputedStyle(el);
          return {
            label: el.getAttribute("aria-label") || el.id || el.getAttribute("placeholder") || el.tagName,
            room: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          };
        }),
    );
  expect(fields.length, "dialog has at least one combobox").toBeGreaterThan(0);
  for (const field of fields) {
    expect(field.room, `text room of ${field.label}`).toBeGreaterThanOrEqual(MIN_TEXT_PX);
  }
}

async function openAddItem(page: Page) {
  await page.goto("/dashboard/inventory");
  await page.getByRole("button", { name: "Add item" }).first().click();
  return page.getByRole("dialog", { name: "Add inventory item" });
}

test("the add inventory item dialog gives every combobox room on a phone", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const dialog = await openAddItem(page);
  await expectComboboxesHaveRoom(dialog);

  // Filled, each combobox shows its clear button: the state that used to
  // leave the least room.
  await dialog.locator("#category").fill("Frukt och grönt");
  await dialog.locator("#location").fill("Kylskåp");
  await dialog.locator("#unit").fill("pcs");
  await dialog.getByRole("textbox", { name: "Name" }).click();
  await expectComboboxesHaveRoom(dialog);
  await expect(dialog.locator("#unit")).toHaveValue("pcs");
  expect(await dialog.locator("#unit").evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
});

test("a filled combobox shows only its clear button on a phone", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const dialog = await openAddItem(page);
  // Location starts empty (unit is prefilled with "pcs").
  const field = dialog.locator("#location");
  const group = dialog.locator("[data-slot=autocomplete-input-group]").filter({ has: page.locator("#location") });
  const clear = group.locator("[data-slot=autocomplete-clear]");
  const trigger = group.locator("[data-slot=autocomplete-trigger]");

  await expect(trigger).toBeVisible();
  await expect(clear).toBeHidden();
  await field.fill("Kylskåp");
  await expect(clear).toBeVisible();
  await expect(trigger).toBeHidden();

  // Clearing brings the chevron back to browse every suggestion.
  await clear.click();
  await expect(field).toHaveValue("");
  await expect(trigger).toBeVisible();
});

test("the shopping edit item dialog gives every combobox room on a phone", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto(`/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`);
  // On a phone the row's Edit sits behind its ⋯ (RowActionsMenu).
  await page.getByRole("button", { name: "More actions for Apples" }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expectComboboxesHaveRoom(page.getByRole("dialog"));
});

test("the new recipe dialog gives the ingredient row room on a phone", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/meal-planning");
  await openRecipesTab(page);
  await page.getByRole("button", { name: "New recipe" }).click();
  const dialog = page.getByRole("dialog", { name: "New recipe" });
  await dialog.getByPlaceholder("Ingredient").fill("Krossade tomater");
  await expectComboboxesHaveRoom(dialog);
});

test("the paste-a-list review gives its shared fields room on a phone", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/inventory");
  // On a phone the header keeps one Add item; the rest live in its menu.
  await page.getByRole("main").getByRole("button", { name: "More inventory actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Paste a list" }).click();
  const dialog = page.getByRole("dialog", { name: "Add items in bulk" });
  await dialog.getByRole("textbox").first().fill("2 cans tomatoes\nMilk");
  await dialog.getByRole("button", { name: "Parse list" }).click();
  // The dialog retitles itself for the review step.
  const review = page.getByRole("dialog", { name: "Review before adding" });
  await expect(review.getByRole("button", { name: "Add 2 items" })).toBeVisible();
  await expectComboboxesHaveRoom(review);
});
