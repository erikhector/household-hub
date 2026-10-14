import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// GAP-45: "Fill empty days" proposes one favorite dinner per empty day as a
// preview, writes nothing until accepted, and offers Undo. Favorites are
// written straight to Postgres, and each project plans in its own far-future
// week (the household is shared by the desktop and mobile runs).
const weekFor = (project: string) => (project === "mobile" ? "2031-03-17" : "2031-03-10");
const suffix = Math.random().toString(36).slice(2, 8);
const recipeId = (i: number) => `e2e-fill-${E2E_WORKER}-${suffix}-${i}`;

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// Only this household's rows: the week's plan (its entries cascade) and the
// recipes this spec made.
async function cleanUp(week: string) {
  await withClient(async (client) => {
    await client.query(`DELETE FROM "MealPlan" WHERE "householdId" = $1 AND "weekStartDate" = $2`, [E2E_HOUSEHOLD.id, week]);
    await client.query(`DELETE FROM "Recipe" WHERE "householdId" = $1 AND id LIKE $2`, [
      E2E_HOUSEHOLD.id,
      `e2e-fill-${E2E_WORKER}-${suffix}-%`,
    ]);
  });
}

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  await dismissCookieNotice(context, baseURL!);
  await cleanUp(weekFor(testInfo.project.name));
  await withClient(async (client) => {
    for (let i = 0; i < 8; i++) {
      await client.query(`INSERT INTO "Recipe" (id, "householdId", name, "isFavorite") VALUES ($1, $2, $3, true)`, [
        recipeId(i),
        E2E_HOUSEHOLD.id,
        `Fav dinner ${suffix} ${i}`,
      ]);
    }
  });
});

test.afterEach(async ({}, testInfo) => {
  await cleanUp(weekFor(testInfo.project.name));
});

// The proposed recipe names, in day order, read from the preview rows.
const proposedNames = (rows: import("@playwright/test").Locator) => rows.locator("span.font-medium").allInnerTexts();

test("a proposal can be cancelled without writing, swapped, accepted, and the entries survive a reload", async ({ page }, testInfo) => {
  const week = weekFor(testInfo.project.name);
  await page.goto(`/dashboard/meal-planning?week=${week}`);

  // Cancel writes nothing.
  await page.getByRole("button", { name: "Fill empty days" }).click();
  const dialog = page.getByRole("dialog", { name: "Fill empty days" });
  await expect(dialog.getByRole("listitem")).toHaveCount(7);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Add meal", exact: true })).toHaveCount(7);

  // Swap the first day's dinner: it changes and every dinner stays unique.
  await page.getByRole("button", { name: "Fill empty days" }).click();
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
  for (const name of names) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add meal", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fill empty days" })).toHaveCount(0);
});

test("Undo on the toast removes exactly the dinners that were added", async ({ page }, testInfo) => {
  const week = weekFor(testInfo.project.name);
  await page.goto(`/dashboard/meal-planning?week=${week}`);

  await page.getByRole("button", { name: "Fill empty days" }).click();
  await page.getByRole("dialog", { name: "Fill empty days" }).getByRole("button", { name: "Add dinners" }).click();
  await expect(page.getByText("Planned 7 dinners")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Added dinners removed")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Add meal", exact: true })).toHaveCount(7);
});
