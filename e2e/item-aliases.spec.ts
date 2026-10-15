import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, openRowSheet } from "./ui";

// MATCH-5: a name the household taught once (ItemAlias) links shopping
// lists too, and "Review ingredient matches" in a recipe's sheet reopens a
// saved recipe's links for correcting. Relies on the "Egg" and "Tomatoes"
// pantry items seeded in e2e/seed.ts.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

// The desktop and mobile runs share one household, and the whole point here
// is that an answer is remembered, so each test starts (and ends) with the
// household's aliases forgotten, as in recipe-ingredients.spec.ts.
async function forgetAliases() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "ItemAlias" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
  } finally {
    await client.end();
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await forgetAliases();
});
test.afterEach(forgetAliases);

async function createRecipe(page: Page, name: string, ingredient: { name: string; quantity: string; unit: string }) {
  await page.goto("/dashboard/meal-planning");
  await page.getByRole("tab", { name: "Recipes" }).click();
  await page.getByRole("button", { name: "New recipe" }).click();
  const dialog = page.getByRole("dialog", { name: "New recipe" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByPlaceholder("Ingredient").fill(ingredient.name);
  // Leave the name field so its suggestion list closes.
  await dialog.getByPlaceholder("Qty").fill(ingredient.quantity);
  await dialog.getByPlaceholder("Unit").fill(ingredient.unit);
  await dialog.getByRole("button", { name: "Create recipe" }).click();
}

async function pickItem(page: Page, combobox: ReturnType<Page["getByRole"]>, label: string) {
  await combobox.fill(label.split(" · ")[0]);
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(combobox).toHaveValue(label);
}

test("a name linked once in a recipe arrives linked in a pasted shopping list", async ({ page }) => {
  // "ägg" shares no letter pair with "Egg", so without the alias the
  // shopping list's fuzzy match could never link it.
  await createRecipe(page, unique("Omelett"), { name: "ägg", quantity: "3", unit: "pcs" });
  const review = page.getByRole("dialog", { name: "Match ingredients" });
  const row = review.getByRole("group", { name: "3 pcs ägg" });
  await row.getByRole("button", { name: "Use existing" }).click();
  await pickItem(page, row.getByRole("combobox", { name: "Pantry item for ägg" }), "Egg · Dairy & eggs");
  await review.getByRole("button", { name: "Create recipe" }).click();
  await expect(page.getByText("Saved · 1 ingredient linked to your pantry")).toBeVisible();

  const listName = unique("Alias shop");
  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(listName);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();

  await page.getByRole("button", { name: "More list actions" }).click();
  await page.getByRole("menuitem", { name: "Import list" }).click();
  const importDialog = page.getByRole("dialog", { name: "Import a list" });
  await importDialog.getByRole("textbox").fill("ägg");
  await importDialog.getByRole("button", { name: "Parse list" }).click();
  // The dialog retitles itself for the review step.
  const reviewDialog = page.getByRole("dialog", { name: "Review before importing" });
  await reviewDialog.getByRole("button", { name: "Import 1 item" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Linked: the row sits under Egg's category, with no "needs mapping" hint.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /^ägg ×/ })).toBeVisible();
  await expect(page.getByText("Dairy & eggs").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("New to your pantry — match it or add it as a new item")).toHaveCount(0);
});

test("“Review ingredient matches” moves a saved link, and the new link is kept", async ({ page }) => {
  const recipeName = unique("Egg salad");
  await createRecipe(page, recipeName, { name: "Egg", quantity: "2", unit: "pcs" });
  // An exact name saves straight away.
  await expect(page.getByText("Saved · 1 ingredient linked to your pantry")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const openReview = async () => {
    const sheet = await openRowSheet(page, recipeName);
    await sheet.getByRole("button", { name: "Review ingredient matches" }).click();
    const review = page.getByRole("dialog", { name: "Match ingredients" });
    // Every row is shown, the confident ones included.
    const row = review.getByRole("group", { name: "2 pcs Egg" });
    await expect(row).toBeVisible();
    return { review, row };
  };

  const { review, row } = await openReview();
  await expect(row.getByRole("button", { name: "Use existing" })).toHaveAttribute("aria-pressed", "true");
  const picker = row.getByRole("combobox", { name: "Pantry item for Egg" });
  await expect(picker).toHaveValue("Egg · Dairy & eggs");
  await pickItem(page, picker, "Tomatoes · Produce");
  await review.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.reload();
  await page.getByRole("tab", { name: "Recipes" }).click();
  const reopened = await openReview();
  await expect(reopened.row.getByRole("combobox", { name: "Pantry item for Egg" })).toHaveValue("Tomatoes · Produce");
});
