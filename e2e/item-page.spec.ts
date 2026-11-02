import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow, openItemUnits, openRowSheet } from "./ui";

// MATCH-6: the item page at /dashboard/inventory/items/[id]. Each test
// writes its own item (straight to Postgres, like recipe-ingredients.spec.ts
// does for aliases), because the desktop and mobile runs share the seeded
// household and these tests change the item's units.
const suffix = () => `${Date.now().toString(36)}-w${E2E_WORKER}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

type Seeded = { id: string; name: string; alias: string; recipes: { buns: string; pancakes: string } };

// Flour counted in bags: "1 pcs = 2000 g" saved, used by one recipe in g
// (converts) and one in dl (doesn't), with one learned name.
async function seedFlour(): Promise<Seeded> {
  const tag = suffix();
  const seeded = {
    id: `e2e-item-page-${tag}`,
    name: `Flour ${tag}`,
    alias: `mjöl ${tag}`,
    recipes: { buns: `Buns ${tag}`, pancakes: `Pancakes ${tag}` },
  };
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
       VALUES ($1, $2, $3, 'Baking', 1, 'pcs', 0.5, now())`,
      [seeded.id, E2E_HOUSEHOLD.id, seeded.name],
    );
    await client.query(
      `INSERT INTO "ItemUnitConversion" (id, "inventoryItemId", "fromUnit", factor) VALUES ($1, $2, 'g', 0.0005)`,
      [`${seeded.id}-g`, seeded.id],
    );
    await client.query(
      `INSERT INTO "ItemAlias" (id, "householdId", "normalizedName", "inventoryItemId") VALUES ($1, $2, $3, $4)`,
      [`${seeded.id}-alias`, E2E_HOUSEHOLD.id, seeded.alias, seeded.id],
    );
    await client.query(
      `INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $3, $2), ($4, $3, $5)`,
      [`${seeded.id}-buns`, seeded.recipes.buns, E2E_HOUSEHOLD.id, `${seeded.id}-pancakes`, seeded.recipes.pancakes],
    );
    await client.query(
      `INSERT INTO "RecipeIngredient" (id, "recipeId", "inventoryItemId", name, quantity, unit)
       VALUES ($1, $2, $5, 'flour', 750, 'g'), ($3, $4, $5, 'flour', 3, 'dl')`,
      [`${seeded.id}-ing-buns`, `${seeded.id}-buns`, `${seeded.id}-ing-pancakes`, `${seeded.id}-pancakes`, seeded.id],
    );
  } finally {
    await client.end();
  }
  return seeded;
}

// Right after navigation the streamed page can briefly hold two copies of
// the inventory list (the Suspense fallback swap), so wait for the visible
// search field before typing.
async function searchInventory(page: Page, query: string) {
  await page.goto("/dashboard/inventory");
  const search = page.getByPlaceholder("Search by name…").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.fill(query);
}

const recipeRow = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

test("an item's details open from the inventory list and show its recipes and learned names", async ({ page }) => {
  const flour = await seedFlour();
  await searchInventory(page, flour.name);
  if (test.info().project.name === "mobile") {
    // The phone card keeps Edit and a ⋯ menu; Details lives in the menu.
    await page.getByRole("main").getByRole("button", { name: "More actions", exact: true }).filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: "Details" }).click();
  } else {
    await page.getByRole("link", { name: `Details for ${flour.name}` }).filter({ visible: true }).click();
  }

  await expect(page.getByRole("heading", { name: flour.name, level: 1 })).toBeVisible();
  // Scoped to main, like after the reload in the next test: the page streams in.
  await expect(page.getByRole("main").getByRole("button", { name: /^Adjust .* \(1 pcs\)$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Used in 2 recipes" })).toBeVisible();
  // 750 g through the saved "1 pcs = 2000 g": converts.
  const buns = recipeRow(page, flour.recipes.buns);
  await expect(buns).toContainText("= 0.375 pcs");
  await expect(buns.getByRole("img", { name: "Converts" })).toBeVisible();
  await expect(recipeRow(page, flour.recipes.pancakes).getByRole("img", { name: "Can't convert dl into pcs" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // A wrong learned name can be removed.
  await page.getByRole("button", { name: `Stop mapping “${flour.alias}” here` }).click();
  await expect(page.getByText("No learned names.")).toBeVisible();
  await page.reload();
  // Scoped to main: see the reload in the next test.
  await expect(page.getByRole("main").getByText("No learned names.")).toBeVisible();

  // The recipe name opens the recipe list, searched down to it.
  await recipeRow(page, flour.recipes.buns).getByRole("link", { name: flour.recipes.buns }).click();
  await expect(page).toHaveURL(/\/dashboard\/meal-planning\?tab=recipes/);
  await expect(page.getByPlaceholder("Search recipes…").filter({ visible: true })).toHaveValue(flour.recipes.buns);
});

// UX-172: status, the stepper and "Add to list" are the first card, ahead of
// the unit algebra, which sits behind a closed "Units" disclosure.
test("the item page opens with the status card, and units sit behind a disclosure", async ({ page }) => {
  const flour = await seedFlour();
  await page.goto(`/dashboard/inventory/items/${flour.id}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: flour.name, level: 1 })).toBeVisible();

  // The first heading after the title is the status card.
  const headings = main.getByRole("heading");
  await expect(headings.nth(0)).toHaveText(flour.name);
  await expect(headings.nth(1)).toHaveText("Status");
  const status = main.getByRole("region", { name: "Status" });
  await expect(status.getByRole("button", { name: /^Adjust .* \(1 pcs\)$/ })).toBeVisible();
  await expect(status.getByText("In stock", { exact: true })).toBeVisible();

  // Units come later and start closed: no "1 pcs = 2000 g" until opened.
  await expect(headings.nth(2)).toHaveText("Units");
  await expect(main.getByText("1 pcs = 2000 g")).toBeHidden();
  await openItemUnits(page);
  await expect(main.getByText("1 pcs = 2000 g")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("adding a conversion from a ⚠ recipe row makes it convert", async ({ page }) => {
  const flour = await seedFlour();
  await page.goto(`/dashboard/inventory/items/${flour.id}`);

  const pancakes = recipeRow(page, flour.recipes.pancakes);
  await pancakes.getByRole("button", { name: "Add dl…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add conversion" });
  await expect(dialog.getByRole("combobox", { name: "Unit" })).toHaveValue("dl");
  // Counted in pcs, so the sentence reads "1 pcs = [20] dl".
  await dialog.getByRole("textbox", { name: "Amount" }).fill("20");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(pancakes).toContainText("= 0.15 pcs");
  await expect(pancakes.getByRole("img", { name: "Converts" })).toBeVisible();
  await page.reload();
  // Scoped to main: while the reload streams in, Next.js parks the page in a
  // hidden container outside main until the Suspense swap, so a page-wide
  // getByText can briefly match two copies.
  await openItemUnits(page);
  await expect(page.getByRole("main").getByText("1 pcs = 20 dl")).toBeVisible();
  await expect(recipeRow(page, flour.recipes.pancakes).getByRole("img", { name: "Converts" })).toBeVisible();

  // "Try it" uses the same conversions, live. By role, not `#try-it-unit`:
  // a CSS locator also matches the hidden copy the reload parks outside
  // main (above), which made this a strict-mode violation now and then.
  await page.getByRole("textbox", { name: "Amount to convert" }).fill("300");
  const unit = page.getByRole("main").getByRole("combobox", { name: "Unit to convert from" });
  await unit.fill("g");
  await unit.press("Tab");
  await expect(page.getByTestId("try-it-result")).toHaveText("= 0.15 pcs");
});

test("the back arrow returns to the catalog filter or recipe tab the item was opened from", async ({ page }) => {
  const flour = await seedFlour();
  const unitProblems = page.getByRole("button", { name: /^Unit problems/ });
  const flourRow = page.getByRole("link", { name: new RegExp(`^${flour.name}\\b`) });

  // The pancakes' dl doesn't convert, so the flour is on "Unit problems".
  await page.goto("/dashboard/inventory/items");
  await unitProblems.click();
  await expect(page).toHaveURL(/\/dashboard\/inventory\/items\?filter=unitProblems$/);
  await flourRow.click();
  await expect(page.getByRole("heading", { name: flour.name, level: 1 })).toBeVisible();

  // The browser's own back lands on the same filter.
  await page.goBack();
  await expect(unitProblems).toHaveAttribute("aria-pressed", "true");
  await flourRow.click();

  // Fix it, then the back arrow goes to the list, where it's gone.
  await recipeRow(page, flour.recipes.pancakes).getByRole("button", { name: "Add dl…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add conversion" });
  await dialog.getByRole("textbox", { name: "Amount" }).fill("20");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("link", { name: "Manage items", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/inventory\/items\?filter=unitProblems$/);
  await expect(unitProblems).toHaveAttribute("aria-pressed", "true");
  await expect(flourRow).toHaveCount(0);

  // From a recipe's ingredient link, it goes back to the Recipes tab.
  await page.goto("/dashboard/meal-planning?tab=recipes");
  const search = page.getByPlaceholder("Search recipes…").filter({ visible: true });
  await search.fill(flour.recipes.buns);
  // The ingredient links are in the recipe's sheet.
  await (await openRowSheet(page, flour.recipes.buns)).getByRole("link", { name: "flour", exact: true }).click();
  await expect(page.getByRole("heading", { name: flour.name, level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Recipes", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/meal-planning\?tab=recipes$/);
  await expect(page.getByPlaceholder("Search recipes…").filter({ visible: true })).toBeVisible();
});

test("changing the unit converts the stock and keeps the old unit as a conversion", async ({ page }) => {
  const flour = await seedFlour();
  await page.goto(`/dashboard/inventory/items/${flour.id}`);

  await page.getByRole("button", { name: "Change unit…" }).click();
  const dialog = page.getByRole("dialog", { name: "Change unit" });
  const unit = dialog.getByRole("combobox", { name: "New unit" });
  await unit.fill("g");
  await unit.press("Tab");
  // Pre-filled from the saved "1 pcs = 2000 g".
  await expect(dialog.getByRole("textbox", { name: "How many g is 1 pcs?" })).toHaveValue("2000");
  await expect(dialog.getByText("Stock: 1 pcs → 2000 g")).toBeVisible();
  await expect(dialog.getByText("Running low below: 0.5 pcs → 1000 g")).toBeVisible();
  await dialog.getByRole("button", { name: "Change unit", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  // Scoped to main: see the reload in "adding a conversion from a ⚠ recipe row".
  const main = page.getByRole("main");
  await expect(main.getByRole("button", { name: /^Adjust .* \(2000 g\)$/ })).toBeVisible();
  await openItemUnits(page);
  await expect(main.getByText("Counted in g")).toBeVisible();
  await expect(main.getByText("1 pcs = 2000 g")).toBeVisible();
  await expect(recipeRow(page, flour.recipes.buns)).toContainText("= 750 g");
});
