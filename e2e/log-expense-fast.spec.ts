import { expect, test, type Page } from "@playwright/test";
import {
  budgetTag,
  insertHouseholdCategory,
  insertHouseholdTransaction,
  insertPersonalCategory,
  insertPersonalTransaction,
  withDb,
} from "./budget-seed";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectTouchTargets } from "./ui";

// UX-109: logging an expense on a phone in three taps. The Add transaction
// sheet opens on Amount (decimal keypad, focused even on a touch open),
// categories are chips (expenses first, recently used on top), the filtered
// or last-used category is preselected, and saving says what was added with
// an Undo.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function seed() {
  const tag = budgetTag();
  const ids = {
    salary: `e2e-fast-salary-${tag}`,
    groceries: `e2e-fast-groceries-${tag}`,
    restaurant: `e2e-fast-restaurant-${tag}`,
  };
  const names = {
    salary: `Salary ${tag}`,
    groceries: `Groceries ${tag}`,
    restaurant: `Restaurang ${tag}`,
  };
  await withDb(async (client) => {
    await insertHouseholdCategory(client, { id: ids.salary, name: names.salary, type: "INCOME" });
    await insertHouseholdCategory(client, { id: ids.groceries, name: names.groceries });
    await insertHouseholdCategory(client, { id: ids.restaurant, name: names.restaurant });
    // Groceries first, Restaurang last: Restaurang is the last-used one,
    // although "Groceries" sorts first alphabetically.
    await insertHouseholdTransaction(client, { id: `${ids.groceries}-tx`, categoryId: ids.groceries, amount: 40 });
    await insertHouseholdTransaction(client, { id: `${ids.restaurant}-tx`, categoryId: ids.restaurant, amount: 90 });
  });
  return { tag, ids, names };
}

function addDialog(page: Page) {
  return page.getByRole("dialog", { name: "Add transaction" });
}

test("the sheet opens on Amount, with chips led by the last-used expense category", async ({ page, isMobile }) => {
  const s = await seed();
  await page.goto("/dashboard/budget");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = addDialog(page);
  await expect(dialog).toBeVisible();

  const amount = dialog.getByLabel("Amount", { exact: true });
  await expect(amount).toBeFocused();
  await expect(amount).toHaveAttribute("inputmode", "decimal");

  // The last-used category is already picked.
  await expect(dialog.getByRole("radio", { name: s.names.restaurant })).toBeChecked();

  // Expenses before income, and the recent one leads its group.
  const names = await dialog.getByRole("radio").evaluateAll((radios) =>
    radios.map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent ?? ""),
  );
  expect(names.indexOf(s.names.restaurant)).toBeGreaterThanOrEqual(0);
  expect(names.indexOf(s.names.restaurant)).toBeLessThan(names.indexOf(s.names.groceries));
  expect(names.indexOf(s.names.groceries)).toBeLessThan(names.indexOf(s.names.salary));

  if (isMobile) await expectTouchTargets(page);
  await expectNoHorizontalOverflow(page);
});

test("saving says what was added, and Undo takes it back", async ({ page }) => {
  const s = await seed();
  await page.goto("/dashboard/budget?tab=transactions");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = addDialog(page);

  // Amount, then Add: the preselected category needs no tap at all.
  await dialog.getByLabel("Amount", { exact: true }).fill("129");
  await dialog.getByLabel("Description").fill(`Lunch ${s.tag}`);
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(dialog).toBeHidden();

  const toast = page.getByText(new RegExp(`Added .*129.* to ${s.names.restaurant}`));
  await expect(toast).toBeVisible();
  // The table (desktop) and the cards (phone) both render the row; one is hidden.
  await expect(page.getByText(`Lunch ${s.tag}`).locator("visible=true").first()).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(`Lunch ${s.tag}`)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(`Lunch ${s.tag}`)).toHaveCount(0);
});

test("another chip can be picked, and the toast names that category", async ({ page }) => {
  const s = await seed();
  await page.goto("/dashboard/budget");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = addDialog(page);

  await dialog.getByLabel("Amount", { exact: true }).fill("55");
  await dialog.getByText(s.names.groceries, { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: s.names.groceries })).toBeChecked();
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText(new RegExp(`Added .*55.* to ${s.names.groceries}`))).toBeVisible();
});

test("the Transactions tab's category filter is preselected", async ({ page }) => {
  const s = await seed();
  await page.goto(`/dashboard/budget?tab=transactions&category=${s.ids.groceries}`);
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  await expect(addDialog(page).getByRole("radio", { name: s.names.groceries })).toBeChecked();
});

test("personal budget: the same sheet, last-used category and Undo", async ({ page }) => {
  const tag = budgetTag();
  const food = { id: `e2e-pfast-food-${tag}`, name: `Food ${tag}` };
  const fun = { id: `e2e-pfast-fun-${tag}`, name: `Fun ${tag}` };
  await withDb(async (client) => {
    await insertPersonalCategory(client, food);
    await insertPersonalCategory(client, fun);
    await insertPersonalTransaction(client, { id: `${food.id}-tx`, categoryId: food.id, amount: 20 });
    await insertPersonalTransaction(client, { id: `${fun.id}-tx`, categoryId: fun.id, amount: 30 });
  });
  await page.goto("/dashboard/personal-budget?tab=transactions");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = addDialog(page);
  await expect(dialog.getByLabel("Amount", { exact: true })).toBeFocused();
  await expect(dialog.getByRole("radio", { name: fun.name })).toBeChecked();

  await dialog.getByLabel("Amount", { exact: true }).fill("77");
  await dialog.getByLabel("Description").fill(`Cinema ${tag}`);
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText(new RegExp(`Added .*77.* to ${fun.name}`))).toBeVisible();
  // Undo is fire-and-forget (the toast closes at once and the delete runs in
  // the background), so reloading right away can abort it mid-request and
  // bring the row back. Wait for the row to leave the live page, which only
  // happens once the delete finished and revalidated, then prove it saved.
  await expect(page.getByText(`Cinema ${tag}`).locator("visible=true").first()).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(`Cinema ${tag}`)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(`Cinema ${tag}`)).toHaveCount(0);
});
