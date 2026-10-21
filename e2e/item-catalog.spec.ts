import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// MATCH-7: the item catalog at /dashboard/inventory/items, its duplicate
// groups, merge and "Not duplicates", and "Merge into another item…" on the
// item page. Each test writes its own items (straight to Postgres, like
// item-page.spec.ts), because the desktop and mobile runs share the seeded
// household and these tests delete or dismiss them. The unique tag goes
// first so the plural fold, which looks at the last word, still applies,
// and it's random rather than time-based so two runs' names aren't similar
// enough for the fuzzy rule to group them together.
const suffix = () => `t${Math.random().toString(36).slice(2, 10)}`;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

type SeedItem = { id: string; name: string; quantity: number; unit: string };

async function seedItems(items: SeedItem[], recipe?: { id: string; name: string; itemId: string; ingredient: string }) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const item of items) {
      await client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
         VALUES ($1, $2, $3, 'Dairy & eggs', $4, $5, now())`,
        [item.id, E2E_HOUSEHOLD.id, item.name, item.quantity, item.unit],
      );
    }
    if (recipe) {
      await client.query(`INSERT INTO "Recipe" (id, "householdId", name) VALUES ($1, $2, $3)`, [
        recipe.id,
        E2E_HOUSEHOLD.id,
        recipe.name,
      ]);
      await client.query(
        `INSERT INTO "RecipeIngredient" (id, "recipeId", "inventoryItemId", name, quantity, unit)
         VALUES ($1, $2, $3, $4, 2, 'pcs')`,
        [`${recipe.id}-ing`, recipe.id, recipe.itemId, recipe.ingredient],
      );
    }
  } finally {
    await client.end();
  }
}

const group = (page: Page, keeperName: string) => page.getByRole("listitem", { name: keeperName, exact: true });

test("a duplicate pair found from the inventory page merges into the item with stock", async ({ page }) => {
  const tag = suffix();
  const keeper = { id: `${tag}-egg`, name: `${tag} egg`, quantity: 6, unit: "pcs" };
  const merged = { id: `${tag}-eggs`, name: `${tag} eggs`, quantity: 0, unit: "pcs" };
  const recipe = { id: `${tag}-omelette`, name: `Omelette ${tag}`, itemId: merged.id, ingredient: "eggs" };
  await seedItems([keeper, merged], recipe);

  await page.goto("/dashboard/inventory");
  // Desktop shows the link in the header; on a phone it sits in the ⋯ menu
  // (with the same duplicate badge and deep link).
  if (test.info().project.name === "mobile") {
    await page.getByRole("main").getByRole("button", { name: "More inventory actions", exact: true }).click();
  }
  const manage = page.getByRole(test.info().project.name === "mobile" ? "menuitem" : "link", { name: /Manage items.*possible duplicate group/ });
  await expect(manage).toBeVisible();
  await manage.click();
  await expect(page).toHaveURL(/\/dashboard\/inventory\/items\?filter=duplicates$/);
  await expect(page.getByRole("button", { name: /Possible duplicates/, pressed: true })).toBeVisible();

  // The one with stock is suggested as the keeper, the other ticked.
  const pair = group(page, keeper.name);
  await expect(pair.getByRole("radio", { name: `Keep ${keeper.name}`, exact: true })).toBeChecked();
  await expect(pair.getByRole("checkbox", { name: `Merge ${merged.name} into the kept item` })).toBeChecked();
  await expect(pair).toContainText("never stocked");
  await expectNoHorizontalOverflow(page);

  await pair.getByRole("button", { name: `Merge into ${keeper.name}` }).click();
  const dialog = page.getByRole("dialog", { name: `Merge into ${keeper.name}` });
  await expect(dialog.getByText("Moves: 1 recipe")).toBeVisible();
  await expect(dialog.getByText("Stock: 6 pcs → 6 pcs")).toBeVisible();
  await expect(dialog.getByText(`“${merged.name}” finds ${keeper.name} from now on`)).toBeVisible();
  await expect(dialog.getByText(`Deletes ${merged.name}`)).toBeVisible();
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await expect(group(page, keeper.name)).toHaveCount(0);

  // The recipe now uses the keeper, and the merged item is gone.
  await page.goto(`/dashboard/inventory/items/${keeper.id}`);
  await expect(page.getByRole("heading", { name: "Used in 1 recipe" })).toBeVisible();
  await expect(page.getByRole("link", { name: recipe.name })).toBeVisible();
  // The merged name is learned, so the next import matches the keeper.
  await expect(page.getByRole("button", { name: `Stop mapping “${merged.name}” here` })).toBeVisible();
  await page.goto(`/dashboard/inventory/items/${merged.id}`);
  await expect(page.getByText("Page not found")).toBeVisible();
  // UX-65: signed in, the 404 still leads back to the dashboard.
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
});

test("“Not duplicates” hides a group for good", async ({ page }) => {
  const tag = suffix();
  const leek = { id: `${tag}-leek`, name: `${tag} leek`, quantity: 1, unit: "pcs" };
  const leeks = { id: `${tag}-leeks`, name: `${tag} leeks`, quantity: 0, unit: "pcs" };
  await seedItems([leek, leeks]);

  await page.goto("/dashboard/inventory/items?filter=duplicates");
  const pair = group(page, leek.name);
  await pair.getByRole("button", { name: "Not duplicates" }).click();
  await expect(page.getByText("Those won't be suggested as duplicates again.")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /Possible duplicates/, pressed: true })).toBeVisible();
  await expect(group(page, leek.name)).toHaveCount(0);
  // Both are still in the full list.
  await page.getByRole("button", { name: /^All/ }).click();
  await expect(page.getByRole("link", { name: new RegExp(`^${leek.name}\\b`) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`^${leeks.name}\\b`) })).toBeVisible();
});

test("“Merge into another item…” shows Cancel and Merge before a pick, and closes on Escape", async ({ page }) => {
  const tag = suffix();
  const jar = { id: `${tag}-jar`, name: `${tag} honey jar`, quantity: 1, unit: "pcs" };
  await seedItems([jar]);

  await page.goto(`/dashboard/inventory/items/${jar.id}`);
  const open = page.getByRole("button", { name: "Merge into another item…" });
  const dialog = page.getByRole("dialog", { name: `Merge ${jar.name} into another item` });

  // UX-11: both actions are there from the start, Merge disabled until an
  // item to keep is picked, and Cancel closes.
  await open.click();
  await expect(dialog.getByRole("button", { name: "Merge", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  // Escape closes it too, with the item picker focused as it is on open.
  await open.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/dashboard/inventory/items/${jar.id}$`));
});

test("“Merge into another item…” on the item page asks for a factor when the units don't convert", async ({ page }) => {
  const tag = suffix();
  const pot = { id: `${tag}-pot`, name: `${tag} cream pot`, quantity: 2, unit: "pcs" };
  const loose = { id: `${tag}-loose`, name: `${tag} loose cream`, quantity: 1, unit: "dl" };
  await seedItems([pot, loose]);

  await page.goto(`/dashboard/inventory/items/${loose.id}`);
  await page.getByRole("button", { name: "Merge into another item…" }).click();
  const dialog = page.getByRole("dialog", { name: `Merge ${loose.name} into another item` });
  await dialog.getByRole("combobox", { name: "Item to keep" }).fill(pot.name);
  await page.getByRole("option", { name: pot.name }).click();

  // Counted in pcs, so the question reads "1 pcs = [2] dl".
  const merge = dialog.getByRole("button", { name: "Merge", exact: true });
  await expect(merge).toBeDisabled();
  await dialog.getByRole("textbox", { name: "How many dl is 1 pcs?" }).fill("2");
  await expect(dialog.getByText("Stock: 2 pcs → 2.5 pcs")).toBeVisible();
  await expect(dialog.getByText("Saves 1 pcs = 2 dl")).toBeVisible();
  await merge.click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/inventory/items/${pot.id}$`));
  await page.reload();
  // Scoped to main: see the reload in item-page.spec.ts.
  const main = page.getByRole("main");
  await expect(main.getByRole("button", { name: /^Adjust .* \(2.5 pcs\)$/ })).toBeVisible();
  await expect(main.getByText("1 pcs = 2 dl")).toBeVisible();
});
