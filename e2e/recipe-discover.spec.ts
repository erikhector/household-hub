import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { format, plural } from "@/lib/i18n/format";
import { RECIPE_CATALOG } from "@/lib/recipe-catalog/data";
import { normalizeForSearch } from "@/lib/recipe-catalog/rank";
import { RECIPE_TAGS } from "@/lib/recipe-tags";
import { E2E_HOUSEHOLD } from "./seed";
import {
  dismissCookieNotice,
  expectHydrated,
  expectNoHorizontalOverflow,
  expectRouterPatched,
  expectTouchTargets,
  openRecipesTab,
  waitForDialogHistory,
} from "./ui";

// Recipe discovery: the Recipes tab's Discover sheet lists catalog recipes
// ranked by the pantry, searches and filters them, previews one with what
// the pantry has, and saves it through the ordinary recipe form (and, from
// Add to plan, goes on to the plan picker). The seeded household's pantry
// holds "Egg" (e2e/seed.ts), so an egg recipe shows both "Have it" and
// "Missing".
const t = en.mealPlanning;
const d = t.discover;

// Catalog recipes the seed doesn't have, picked from the catalog rather than
// hardcoded so a catalog edit can't silently break the spec. Each one's name
// is a search that finds only that recipe (no other name or ingredient
// contains it), so "it's the first row" and "every row is it" are exact.
const SEEDED = ["Cinnamon buns", "Pancakes", "Porridge"].map(normalizeForSearch);
const findsOnlyItself = RECIPE_CATALOG.filter((recipe) => {
  const query = normalizeForSearch(recipe.name.en);
  if (SEEDED.includes(query)) return false;
  return RECIPE_CATALOG.every(
    (other) =>
      other === recipe ||
      (!normalizeForSearch(other.name.en).includes(query) &&
        !other.ingredients.some((ingredient) => normalizeForSearch(ingredient.name.en).includes(query))),
  );
});
const usesEgg = (recipe: (typeof RECIPE_CATALOG)[number]) =>
  recipe.ingredients.some((ingredient) => ingredient.name.en === "egg") &&
  recipe.ingredients.some((ingredient) => ingredient.name.en !== "egg");
const RECIPE_A = findsOnlyItself.find(usesEgg)!;
const RECIPE_B = findsOnlyItself.find((recipe) => recipe !== RECIPE_A)!;
const NAME_A = RECIPE_A.name.en;
const NAME_B = RECIPE_B.name.en;
const MISSING_TAG = RECIPE_TAGS.find((tag) => !RECIPE_A.tags.includes(tag))!;

// "You have 0 of", the start of a count line for a recipe the pantry
// covers none of. No row may show it.
const HAVE_NONE = format(plural(0, d.haveCount), { count: 0, total: "" }).trim();

let startedAt: Date;

test.beforeEach(async ({ context, baseURL }) => {
  expect(RECIPE_A, "a catalog recipe with egg whose name finds only itself").toBeDefined();
  expect(RECIPE_B, "a second catalog recipe whose name finds only itself").toBeDefined();
  await dismissCookieNotice(context, baseURL!);
  // A little before now, so rows the database stamps during the test are
  // counted even with a millisecond of clock skew.
  startedAt = new Date(Date.now() - 1000);
});

// Removes what a save made, in this worker's household only: the two
// recipes (with any plan entry the plan test put them in; that FK is
// SET NULL, so the entry would otherwise outlive the recipe), and the
// pantry items and learned names the ingredient review created for them.
test.afterEach(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const names = [NAME_A, NAME_B];
    await client.query(
      `DELETE FROM "MealPlanEntry" WHERE "recipeId" IN (SELECT id FROM "Recipe" WHERE "householdId" = $1 AND name = ANY($2))`,
      [E2E_HOUSEHOLD.id, names],
    );
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND name = ANY($2)`, [E2E_HOUSEHOLD.id, names]);
    await client.query(`DELETE FROM "ItemAlias" WHERE "householdId" = $1 AND "createdAt" >= $2`, [
      E2E_HOUSEHOLD.id,
      startedAt,
    ]);
    await client.query(`DELETE FROM "InventoryItem" WHERE "householdId" = $1 AND "createdAt" >= $2`, [
      E2E_HOUSEHOLD.id,
      startedAt,
    ]);
  } finally {
    await client.end();
  }
});

async function openDiscover(page: Page) {
  const button = page.getByRole("main").getByRole("button", { name: d.open, exact: true });
  await expectHydrated(button);
  await expectRouterPatched(page);
  await button.click();
  const sheet = page.getByRole("dialog", { name: d.title });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function openTabAndDiscover(page: Page) {
  await page.goto("/dashboard/meal-planning");
  await openRecipesTab(page);
  return openDiscover(page);
}

function resultRows(page: Page) {
  return page.getByRole("dialog").getByRole("list", { name: d.results }).getByRole("listitem");
}

// Searches the sheet for `name` and opens its preview, which is titled
// with the recipe's name.
async function previewRecipe(page: Page, name: string) {
  const sheet = page.getByRole("dialog", { name: d.title });
  await sheet.getByRole("searchbox", { name: d.searchLabel }).fill(name);
  const rows = resultRows(page);
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole("button").click();
  const preview = page.getByRole("dialog", { name, exact: true });
  await expect(preview.getByRole("button", { name: d.save })).toBeEnabled();
  return preview;
}

// Saves the open recipe form, through the ingredient review: catalog
// ingredients the pantry doesn't know start on "Create new", which is kept.
async function saveThroughReview(page: Page) {
  await page.getByRole("dialog", { name: t.newRecipeDialogTitle }).getByRole("button", { name: t.create }).click();
  const review = page.getByRole("dialog", { name: t.ingredientReview.title });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: t.create }).click();
}

test("discover shows pantry-based suggestions", async ({ page }) => {
  const sheet = await openTabAndDiscover(page);
  await expect(sheet.getByRole("heading", { name: d.goodWithWhatYouHave })).toBeVisible();
  const rows = sheet.getByRole("list", { name: d.goodWithWhatYouHave }).getByRole("listitem");
  await expect(rows.first()).toBeVisible();
  // Each row says how much of it the pantry covers.
  await expect(rows.first()).toContainText(/You have \d+ of \d+/);
  await expect(sheet.getByText(HAVE_NONE)).toHaveCount(0);
});

test("rows never say the pantry has none of a recipe", async ({ page }) => {
  // A tag filter lists recipes whatever the pantry covers, so most rows
  // here share nothing with the seeded pantry. They show no count at all
  // rather than "You have 0 of N".
  const sheet = await openTabAndDiscover(page);
  const chip = sheet.getByRole("button", { name: t.recipeTags[RECIPE_TAGS[0]], exact: true });
  await expectHydrated(chip);
  await chip.click();
  await expect(sheet.getByRole("heading", { name: d.results })).toBeVisible();
  await expect(resultRows(page).first()).toBeVisible();
  await expect(sheet.getByText(HAVE_NONE)).toHaveCount(0);
});

test("search and tag filter narrow the list", async ({ page }) => {
  const sheet = await openTabAndDiscover(page);
  await sheet.getByRole("searchbox", { name: d.searchLabel }).fill(NAME_A);
  await expect(sheet.getByRole("heading", { name: d.results })).toBeVisible();
  await expect(resultRows(page).first()).toContainText(NAME_A);

  const chip = sheet.getByRole("button", { name: t.recipeTags[MISSING_TAG], exact: true });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByText(d.emptyFiltered)).toBeVisible();

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(resultRows(page).first()).toContainText(NAME_A);
});

test("shows results for the last query typed", async ({ page }) => {
  const sheet = await openTabAndDiscover(page);
  const search = sheet.getByRole("searchbox", { name: d.searchLabel });
  await search.fill("pasta");
  await search.fill(NAME_A);
  const rows = resultRows(page);
  await expect(rows).toHaveCount(1, { timeout: 5000 });
  await expect(rows.first()).toContainText(NAME_A, { timeout: 5000 });
});

test("save a catalog recipe through the form", async ({ page }) => {
  await openTabAndDiscover(page);
  const preview = await previewRecipe(page, NAME_A);
  // The egg is in the seeded pantry; the rest isn't. Marked in words too.
  await expect(preview.getByText(d.haveIt, { exact: true }).first()).toBeVisible();
  await expect(preview.getByText(d.missing, { exact: true }).first()).toBeVisible();
  await preview.getByRole("button", { name: d.save }).click();

  const form = page.getByRole("dialog", { name: t.newRecipeDialogTitle });
  await expect(form.getByRole("textbox", { name: t.recipeNameLabel })).toHaveValue(NAME_A);
  await saveThroughReview(page);
  await waitForDialogHistory(page);

  await page.reload();
  await openRecipesTab(page);
  await expect(page.getByRole("main").getByText(NAME_A, { exact: true }).first()).toBeVisible();

  // Saved recipes drop out of discovery.
  const sheet = await openDiscover(page);
  await sheet.getByRole("searchbox", { name: d.searchLabel }).fill(NAME_A);
  await expect(sheet.getByText(d.emptySearch)).toBeVisible();
});

test("add to plan saves then opens the plan dialog", async ({ page }) => {
  await openTabAndDiscover(page);
  const preview = await previewRecipe(page, NAME_B);
  await preview.getByRole("button", { name: d.addToPlan }).click();

  const form = page.getByRole("dialog", { name: t.newRecipeDialogTitle });
  await expect(form.getByRole("textbox", { name: t.recipeNameLabel })).toHaveValue(NAME_B);
  await saveThroughReview(page);

  // The picker opens for the recipe just created, and plans it. A day far
  // ahead, so no other spec's "this week" sees it before the cleanup.
  const plan = page.getByRole("dialog", { name: format(t.addToPlanDialogTitle, { recipe: NAME_B }) });
  await expect(plan).toBeVisible();
  const day = new Date(Date.now() + (9500 + Math.floor(Math.random() * 2000)) * 24 * 60 * 60 * 1000);
  await plan.getByLabel(t.dateLabel).fill(day.toISOString().slice(0, 10));
  await plan.getByRole("button", { name: t.addToPlanSubmit, exact: true }).click();
  await expect(plan).toHaveCount(0);
  await expect(page.getByText(format(t.addedToPlanDifferentWeekToast, { recipe: NAME_B }))).toBeVisible();
  await waitForDialogHistory(page);
});

test("a second discover pick fills the form with that recipe", async ({ page }) => {
  await openTabAndDiscover(page);
  let preview = await previewRecipe(page, NAME_A);
  await preview.getByRole("button", { name: d.save }).click();
  const form = page.getByRole("dialog", { name: t.newRecipeDialogTitle });
  const name = form.getByRole("textbox", { name: t.recipeNameLabel });
  await expect(name).toHaveValue(NAME_A);
  await page.keyboard.press("Escape");
  await waitForDialogHistory(page);

  // The form is mounted now; the next pick must still be the one it shows.
  await openDiscover(page);
  preview = await previewRecipe(page, NAME_B);
  await preview.getByRole("button", { name: d.save }).click();
  await expect(name).toHaveValue(NAME_B);
});

test("new recipe is blank after a cancelled discover save", async ({ page }) => {
  await openTabAndDiscover(page);
  const preview = await previewRecipe(page, NAME_A);
  await preview.getByRole("button", { name: d.save }).click();
  const form = page.getByRole("dialog", { name: t.newRecipeDialogTitle });
  await expect(form.getByRole("textbox", { name: t.recipeNameLabel })).toHaveValue(NAME_A);
  await page.keyboard.press("Escape");
  await waitForDialogHistory(page);

  const newRecipe = page.getByRole("main").getByRole("button", { name: t.newRecipe, exact: true }).filter({ visible: true });
  await expectHydrated(newRecipe);
  await newRecipe.click();
  await expect(page.getByRole("dialog", { name: t.newRecipeDialogTitle }).getByRole("textbox", { name: t.recipeNameLabel })).toHaveValue("");
});

test("sheet fits a phone", async ({ page, isMobile }) => {
  const sheet = await openTabAndDiscover(page);
  await expect(sheet.getByRole("list", { name: d.goodWithWhatYouHave }).getByRole("listitem").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (isMobile) await expectTouchTargets(page);

  // The preview too: its sticky Save and Add to plan.
  await previewRecipe(page, NAME_A);
  await expectNoHorizontalOverflow(page);
  if (isMobile) await expectTouchTargets(page);
});

// AI ideas. The webServer env in playwright.config.ts sets a placeholder
// GEMINI_API_KEY (for the photo import), so the button is offered here; the
// real call is mocked at the Server Action POST, as in
// recipe-photo-import.spec.ts, so no provider is contacted. (A run without a
// key can't be reached from this suite; the gate is a prop check.)
async function mockIdeasAction(page: Page, payload: unknown) {
  await page.route(
    (url) => url.pathname.startsWith("/dashboard/meal-planning"),
    async (route) => {
      const request = route.request();
      const body = request.postData() ?? "";
      // The ideas action is the only POST that carries tags without a query.
      if (request.method() === "POST" && body.includes('"tags"') && !body.includes('"query"')) {
        await route.fulfill({
          status: 200,
          contentType: "text/x-component",
          body: `0:{"a":"$@1","f":"","b":"e2e"}\n1:${JSON.stringify(payload)}\n`,
        });
        return;
      }
      await route.continue();
    },
  );
}

test("ask for ideas lists AI ideas and previews one without pantry markers", async ({ page }) => {
  const name = `Idea stew ${Date.now().toString(36)}`;
  await mockIdeasAction(page, {
    ideas: [
      {
        name,
        instructions: "Chop everything.\nSimmer for 20 minutes.",
        servings: 4,
        tags: [],
        ingredients: [{ name: "carrot", quantity: 3, unit: "pcs", rawText: "3 carrots" }],
      },
    ],
  });
  const sheet = await openTabAndDiscover(page);
  const ask = sheet.getByRole("button", { name: d.askForIdeas });
  await expectHydrated(ask);
  await ask.click();

  const ideas = sheet.getByRole("list", { name: d.ideasHeading });
  await expect(ideas.getByRole("listitem")).toHaveCount(1);
  await expect(ideas.getByText(d.aiIdeaBadge)).toBeVisible();
  // The catalog list stays in place under the ideas.
  await expect(sheet.getByRole("list", { name: d.goodWithWhatYouHave })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await ideas.getByRole("button", { name: new RegExp(name) }).click();
  const preview = page.getByRole("dialog", { name, exact: true });
  await expect(preview.getByText("carrot")).toBeVisible();
  await expect(preview.getByText(d.aiIdeaBadge)).toBeVisible();
  await expect(preview.getByText(d.haveIt, { exact: true })).toHaveCount(0);
  await expect(preview.getByText(d.missing, { exact: true })).toHaveCount(0);
  await expect(preview.getByRole("button", { name: d.save })).toBeEnabled();
  await expectNoHorizontalOverflow(page);

  // Back keeps the ideas; closing and reopening drops them.
  await preview.getByRole("button", { name: d.back }).click();
  await expect(ideas.getByRole("listitem")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  const reopened = await openDiscover(page);
  await expect(reopened.getByRole("list", { name: d.ideasHeading })).toHaveCount(0);
});

test("ask for ideas shows the error inline", async ({ page }) => {
  await mockIdeasAction(page, { error: d.ideasBusy });
  const sheet = await openTabAndDiscover(page);
  const ask = sheet.getByRole("button", { name: d.askForIdeas });
  await expectHydrated(ask);
  await ask.click();
  await expect(sheet.getByRole("alert").filter({ hasText: d.ideasBusy })).toBeVisible();
  await expect(sheet.getByRole("list", { name: d.goodWithWhatYouHave })).toBeVisible();
});

// M8: offline or a dropped connection rejects the Server Action call itself
// (no answer at all), which used to escape to the dashboard error boundary
// and take the sheet with it. These abort the action POST at the network
// level. The two actions are told apart by their arguments: the search sends
// a query, the ideas action only tags (as in mockIdeasAction).
function isActionPost(request: { method(): string; headers(): Record<string, string> }) {
  return request.method() === "POST" && "next-action" in request.headers();
}

test("ask for ideas offline shows the error inline and keeps the sheet", async ({ page }) => {
  await page.route(
    (url) => url.pathname.startsWith("/dashboard/meal-planning"),
    async (route) => {
      const request = route.request();
      const body = request.postData() ?? "";
      if (isActionPost(request) && body.includes('"tags"') && !body.includes('"query"')) {
        await route.abort("internetdisconnected");
        return;
      }
      await route.continue();
    },
  );
  const sheet = await openTabAndDiscover(page);
  const ask = sheet.getByRole("button", { name: d.askForIdeas });
  await expectHydrated(ask);
  await ask.click();
  await expect(sheet.getByRole("alert").filter({ hasText: d.ideasFailed })).toBeVisible();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("list", { name: d.goodWithWhatYouHave })).toBeVisible();
  await expect(ask).toBeEnabled();
});

test("search offline shows the inline retry and keeps the previous results", async ({ page }) => {
  let failSearch = false;
  await page.route(
    (url) => url.pathname.startsWith("/dashboard/meal-planning"),
    async (route) => {
      const request = route.request();
      if (failSearch && isActionPost(request) && (request.postData() ?? "").includes('"query"')) {
        await route.abort("internetdisconnected");
        return;
      }
      await route.continue();
    },
  );
  const sheet = await openTabAndDiscover(page);
  const search = sheet.getByRole("searchbox", { name: d.searchLabel });
  await expectHydrated(search);
  await search.fill(NAME_A);
  const rows = resultRows(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(NAME_A);

  failSearch = true;
  await search.fill(NAME_B);
  const alert = sheet.getByRole("alert").filter({ hasText: d.errorLoad });
  await expect(alert).toBeVisible();
  await expect(sheet).toBeVisible();
  // The rows from the last answer stay rather than an empty list.
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(NAME_A);

  // Back online, Retry runs the same search.
  failSearch = false;
  await alert.getByRole("button", { name: d.retry }).click();
  await expect(alert).toBeHidden();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(NAME_B);
});
