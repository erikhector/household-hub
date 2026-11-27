import { expect, test, type Page } from "@playwright/test";
import { uniqueId, uniqueTag, withDb } from "./db";
import { E2E_HOUSEHOLD } from "./seed";
import { dismissCookieNotice, expectHydrated, holdServerActions } from "./ui";

// UX-213: the planner's whole-week actions show they're running and say so
// when the server can't be reached. Copy last week's menu item closes on
// tap, so its pending state is on the ⋯ trigger; Fill empty days' submit
// swaps to a busy label. The Server Action is held (or dropped) at the
// network so the pending and offline states can be asserted, not raced.
//
// The household is shared by the desktop and mobile runs, so each project
// has its own weeks. They sit in 2198: not a past week (Fill only proposes
// days that haven't passed), clear of far-weeks.ts' 2036-2099 bands and of
// meal-planner-fill-empty-days.spec.ts' 2199 weeks, and no other spec uses
// them, so the cleanup by week below can't wipe another spec's plan.
const weeksFor = (project: string) =>
  project === "mobile"
    ? { source: "2198-02-05", target: "2198-02-12", fill: "2198-02-26" }
    : { source: "2198-01-08", target: "2198-01-15", fill: "2198-01-29" };
const PATH = "/dashboard/meal-planning";
const tag = uniqueTag();
const recipeId = uniqueId("e2e-ux213-recipe");
const recipeName = `Progress stew ${tag}`;

// Only this household's rows: the spec's weeks (their entries cascade) and
// its one recipe.
async function cleanUp(project: string) {
  const { source, target, fill } = weeksFor(project);
  await withDb(async (client) => {
    await client.query(`DELETE FROM "MealPlan" WHERE "householdId" = $1 AND "weekStartDate" = ANY($2::timestamp[])`, [
      E2E_HOUSEHOLD.id,
      [source, target, fill],
    ]);
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND id = $2`, [E2E_HOUSEHOLD.id, recipeId]);
  });
}

// Last week has one dinner, so Copy last week has something to copy.
async function seedSourceWeek(source: string) {
  const planId = uniqueId("e2e-ux213-plan");
  await withDb(async (client) => {
    await client.query(`INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)`, [
      planId,
      E2E_HOUSEHOLD.id,
      source,
    ]);
    await client.query(
      `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName", portions)
       VALUES ($1, $2, $3, 'DINNER', $4, 2)`,
      [uniqueId("e2e-ux213-entry"), planId, source, `Copied soup ${tag}`],
    );
  });
}

async function copyLastWeek(page: Page, target: string) {
  await page.goto(`${PATH}?week=${target}`);
  const more = page.getByRole("button", { name: "More planner actions" });
  await expectHydrated(more);
  await more.click();
  await page.getByRole("menuitem", { name: "Copy last week" }).click();
  return more;
}

let release: (() => void) | undefined;

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  await dismissCookieNotice(context, baseURL!);
  await cleanUp(testInfo.project.name);
});

test.afterEach(async ({}, testInfo) => {
  // A failed assertion can end a test with an action still held: let it
  // through before the cleanup, so it can't write after it.
  release?.();
  release = undefined;
  await cleanUp(testInfo.project.name);
});

test("Copy last week shows a busy ⋯ trigger until its toast", async ({ page }, testInfo) => {
  const { source, target } = weeksFor(testInfo.project.name);
  await seedSourceWeek(source);
  const held = await holdServerActions(page, PATH);
  release = held.release;

  const more = await copyLastWeek(page, target);
  await expect(more).toBeDisabled();
  await expect(more).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("Copied 1 meal from last week")).toHaveCount(0);

  held.release();
  await expect(page.getByText("Copied 1 meal from last week")).toBeVisible();
  await expect(more).toBeEnabled();
  await expect(more).not.toHaveAttribute("aria-busy");
});

test("Fill empty days shows its busy label while the dinners are added", async ({ page }, testInfo) => {
  const { fill } = weeksFor(testInfo.project.name);
  await withDb(async (client) => {
    await client.query(`INSERT INTO "Recipe" (id, "householdId", name, "isFavorite") VALUES ($1, $2, $3, true)`, [
      recipeId,
      E2E_HOUSEHOLD.id,
      recipeName,
    ]);
  });
  const held = await holdServerActions(page, PATH);
  release = held.release;

  await page.goto(`${PATH}?week=${fill}`);
  const more = page.getByRole("button", { name: "More planner actions" });
  await expectHydrated(more);
  await more.click();
  await page.getByRole("menuitem", { name: "Fill empty days" }).click();
  const dialog = page.getByRole("dialog", { name: "Fill empty days" });
  await dialog.getByRole("button", { name: "Add dinners" }).click();
  const busy = dialog.getByRole("button", { name: "Adding dinners…" });
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();

  held.release();
  await expect(page.getByText(/^Planned \d+ dinners?$/)).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("a dropped connection says so and stays on the planner", async ({ page }, testInfo) => {
  const { source, target } = weeksFor(testInfo.project.name);
  await seedSourceWeek(source);
  await page.route(
    (url) => url.pathname === PATH,
    (route) => {
      const request = route.request();
      return request.method() === "POST" && "next-action" in request.headers() ? route.abort("failed") : route.continue();
    },
  );

  const more = await copyLastWeek(page, target);
  await expect(page.getByText("Couldn't reach the server. Check your connection and try again.")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${PATH}\\?week=${target}$`));
  await expect(more).toBeEnabled();
  // The planner itself still shows, not the error boundary.
  await expect(page.getByRole("button", { name: "Add first dinner" })).toBeVisible();
});
