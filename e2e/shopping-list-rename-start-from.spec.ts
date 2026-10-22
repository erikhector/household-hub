import { expect, test, type Page } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice } from "./ui";

// UX-85: rename a list, and start a new list from a template or a past list.
// Every test makes its own lists so it neither depends on nor changes the
// seeded ones. The closing letter keeps the smart add line from reading a
// timestamp's trailing digits as a quantity (see copy-shopping-list-text).
const unique = (label: string) => `${label} ${Date.now().toString(36)}z`;
const t = en.shoppingList;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function makeList(page: Page, name: string, items: string[]) {
  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const addBox = page.getByRole("combobox", { name: "Add to the list" });
  await addBox.fill(items.join(", "));
  await addBox.press("Enter");
  for (const item of items) {
    await expect(page.getByRole("checkbox", { name: new RegExp(`^${item}\\b`, "i") })).toBeVisible();
  }
}

// Wait for the action's response before leaving, or the navigation can drop
// the tick.
async function tick(page: Page, item: string) {
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
  );
  const box = page.getByRole("checkbox", { name: new RegExp(`^${item}\\b`, "i") });
  await box.click();
  await expect(box).toBeHidden();
  await saved;
}

test("Rename in the ⋯ menu changes the title and survives a reload", async ({ page }) => {
  const before = unique("Rename me");
  const after = unique("Renamed");
  await makeList(page, before, [unique("Rice")]);

  await page.getByRole("button", { name: t.moreActions }).click();
  await page.getByRole("menuitem", { name: t.renameList.menuItem }).click();
  const field = page.getByRole("textbox", { name: t.renameList.nameLabel });
  await expect(field).toHaveValue(before);
  await field.fill(after);
  await page.getByRole("button", { name: t.renameList.save }).click();

  await expect(page.getByRole("heading", { level: 1, name: after })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: after })).toBeVisible();
});

test("tapping the title opens Rename too", async ({ page }) => {
  const before = unique("Tap me");
  const after = unique("Tapped");
  await makeList(page, before, [unique("Tea")]);

  await page.getByRole("heading", { level: 1, name: before }).click();
  const field = page.getByRole("textbox", { name: t.renameList.nameLabel });
  await field.fill(after);
  await page.getByRole("button", { name: t.renameList.save }).click();
  await expect(page.getByRole("heading", { level: 1, name: after })).toBeVisible();
});

test("a new list can start from a past list's unbought items", async ({ page }) => {
  const source = unique("Last week");
  const milk = unique("Milk");
  const bread = unique("Bread");
  await makeList(page, source, [milk, bread]);
  // Ticked off, so it is in the cart and stays behind.
  await tick(page, milk);

  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  const copy = unique("This week");
  await page.getByRole("textbox", { name: "Name" }).fill(copy);
  await page.getByRole("combobox", { name: t.startFrom.label }).click();
  await page.getByRole("option", { name: source, exact: true }).click();
  // Only what is still to buy is the default.
  await expect(page.getByRole("radio", { name: t.startFrom.itemsUnbought })).toBeChecked();
  await page.getByRole("button", { name: "Create list" }).click();

  await expect(page.getByRole("heading", { level: 1, name: copy })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${bread}\\b`, "i") })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${milk}\\b`, "i") })).toHaveCount(0);
});

test("a past list with everything ticked defaults to copying all items", async ({ page }) => {
  const source = unique("Done trip");
  const eggs = unique("Eggs");
  await makeList(page, source, [eggs]);
  await tick(page, eggs);

  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  const copy = unique("Again");
  await page.getByRole("textbox", { name: "Name" }).fill(copy);
  await page.getByRole("combobox", { name: t.startFrom.label }).click();
  await page.getByRole("option", { name: source, exact: true }).click();
  // Nothing is left to buy, so "only what is still to buy" would copy nothing.
  await expect(page.getByRole("radio", { name: t.startFrom.itemsAll })).toBeChecked();
  await page.getByRole("button", { name: "Create list" }).click();

  await expect(page.getByRole("heading", { level: 1, name: copy })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${eggs}\\b`, "i") })).toBeVisible();
});

test("a new list can start from a template, and its row says Use", async ({ page }) => {
  const source = unique("Taco night");
  const salsa = unique("Salsa");
  await makeList(page, source, [salsa]);

  await page.getByRole("button", { name: t.moreActions }).click();
  await page.getByRole("menuitem", { name: t.templates.menuItem }).click();
  const template = unique("Tacos");
  await page.getByRole("textbox", { name: t.templates.nameLabel }).fill(template);
  await page.getByRole("button", { name: t.templates.save, exact: true }).click();
  await expect(page.getByText(`Saved as template "${template}"`)).toBeVisible();

  await page.goto("/dashboard/shopping-list");
  // The template row's button is "Use", not a second "New list".
  await expect(page.getByRole("button", { name: `Use template "${template}"` })).toHaveText("Use");

  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("combobox", { name: t.startFrom.label }).click();
  await page.getByRole("option", { name: template, exact: true }).click();
  // The empty name field says what the list will be called.
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveAttribute("placeholder", template);
  await page.getByRole("button", { name: "Create list" }).click();

  // No name typed: the list takes the template's.
  await expect(page.getByRole("heading", { level: 1, name: template })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${salsa}\\b`, "i") })).toBeVisible();
});
