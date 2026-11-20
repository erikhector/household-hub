import { expect, test } from "@playwright/test";
import { uniqueTag, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// GAP-45: "Fill empty days" proposes one favorite dinner per empty day as a
// preview, writes nothing until accepted, and offers Undo. Favorites are
// written straight to Postgres, and each project plans in its own far-future
// week (the household is shared by the desktop and mobile runs). No other
// spec may use these weeks either: cleanUp deletes the week's plan by date,
// and they used to be planner-add-missing.spec.ts's planned weeks, whose
// seeded meal that delete could wipe mid-test (found with MAINT-115). Not a
// past week, since Fill only proposes days that haven't passed, and not one
// in 2036-2093, where far-weeks.ts hands out the random far-off weeks other
// specs plan in, so that delete could wipe their plan too. 2199 is beyond
// all of them.
const weekFor = (project: string) => (project === "mobile" ? "2199-08-12" : "2199-08-05");
const tag = uniqueTag();
const recipeId = (i: number) => `e2e-fill-${E2E_WORKER}-${tag}-${i}`;

// Only this household's rows: the week's plan (its entries cascade) and the
// recipes this spec made.
async function cleanUp(week: string) {
  await withDb(async (client) => {
    await client.query(`DELETE FROM "MealPlan" WHERE "householdId" = $1 AND "weekStartDate" = $2`, [E2E_HOUSEHOLD.id, week]);
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND id LIKE $2`, [
      E2E_HOUSEHOLD.id,
      `e2e-fill-${E2E_WORKER}-${tag}-%`,
    ]);
  });
}

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  await dismissCookieNotice(context, baseURL!);
  await cleanUp(weekFor(testInfo.project.name));
  await withDb(async (client) => {
    for (let i = 0; i < 8; i++) {
      await client.query(`INSERT INTO "Recipe" (id, "householdId", name, "isFavorite") VALUES ($1, $2, $3, true)`, [
        recipeId(i),
        E2E_HOUSEHOLD.id,
        `Fav dinner ${tag} ${i}`,
      ]);
    }
  });
});

test.afterEach(async ({}, testInfo) => {
  await cleanUp(weekFor(testInfo.project.name));
});

async function openFill(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "More planner actions" }).click();
  await page.getByRole("menuitem", { name: "Fill empty days" }).click();
}

// The proposed recipe names, in day order, read from the preview rows.
const proposedNames = (rows: import("@playwright/test").Locator) => rows.locator("span.font-medium").allInnerTexts();

test("a proposal can be cancelled without writing, swapped, accepted, and the entries survive a reload", async ({ page }, testInfo) => {
  const week = weekFor(testInfo.project.name);
  await page.goto(`/dashboard/meal-planning?week=${week}`);

  // Cancel writes nothing.
  await openFill(page);
  const dialog = page.getByRole("dialog", { name: "Fill empty days" });
  await expect(dialog.getByRole("listitem")).toHaveCount(7);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Add first dinner" })).toBeVisible();

  // Swap the first day's dinner: it changes and every dinner stays unique.
  await openFill(page);
  const rows = dialog.getByRole("listitem");
  const [first] = await proposedNames(rows);
  await dialog.getByRole("button", { name: /^Swap the dinner on/ }).first().click();
  await expect.poll(async () => (await proposedNames(rows))[0]).not.toBe(first);
  const names = await proposedNames(rows);
  expect(new Set(names).size).toBe(7);
  if (testInfo.project.name === "mobile") await expectNoHorizontalOverflow(page);

  // Accept: each empty day gets its dinner, and it is still there after a reload.
  await dialog.getByRole("button", { name: "Add dinners" }).click();
  await expect(page.getByText("Planned 7 dinners")).toBeVisible();
  await page.reload();
  for (const name of names) await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "More planner actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Fill empty days" })).toHaveCount(0);
});

test("Undo on the toast removes exactly the dinners that were added", async ({ page }, testInfo) => {
  const week = weekFor(testInfo.project.name);
  await page.goto(`/dashboard/meal-planning?week=${week}`);

  await openFill(page);
  await page.getByRole("dialog", { name: "Fill empty days" }).getByRole("button", { name: "Add dinners" }).click();
  await expect(page.getByText("Planned 7 dinners")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Added dinners removed")).toBeVisible();
  // PERF-19: the week empties without a reload (no router.refresh() follows
  // the undo; the action's own revalidation re-renders the page).
  await expect(page.getByRole("button", { name: "Add first dinner" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Add first dinner" })).toBeVisible();
});

// UX-97: favorites come first, then other recipes fill the remaining days, so
// a week is full whenever the household has enough recipes at all.
test("with only two favorites, the other empty days are filled from non-favorite recipes", async ({ page }, testInfo) => {
  const week = weekFor(testInfo.project.name);
  await withDb(async (client) => {
    await client.query(`UPDATE "Recipe" SET "isFavorite" = false WHERE "householdId" = $1 AND id LIKE $2 AND id NOT IN ($3, $4)`, [
      E2E_HOUSEHOLD.id,
      `e2e-fill-${E2E_WORKER}-${tag}-%`,
      recipeId(0),
      recipeId(1),
    ]);
  });
  await page.goto(`/dashboard/meal-planning?week=${week}`);

  await openFill(page);
  const dialog = page.getByRole("dialog", { name: "Fill empty days" });
  const rows = dialog.getByRole("listitem");
  await expect(rows).toHaveCount(7);
  await expect(dialog.getByText(/fewer unplanned recipes than empty days/)).toBeHidden();
  const names = await proposedNames(rows);
  expect(new Set(names).size).toBe(7);
  // Both favorites are proposed, ahead of the non-favorites that fill the rest.
  expect(names).toContain(`Fav dinner ${tag} 0`);
  expect(names).toContain(`Fav dinner ${tag} 1`);

  await dialog.getByRole("button", { name: "Add dinners" }).click();
  await expect(page.getByText("Planned 7 dinners")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "More planner actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Fill empty days" })).toHaveCount(0);
});
