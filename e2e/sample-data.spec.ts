import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { en } from "../src/lib/i18n/dictionaries/en";
import { sv } from "../src/lib/i18n/dictionaries/sv";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-136: an empty household can opt in to a small made-up home, and clear
// exactly that again. The seeded household already has rows everywhere, so
// each test gets its own empty household and account (straight to Postgres,
// like empty-states.spec.ts) and logs in through the real form.
test.use({ storageState: { cookies: [], origins: [] } });

const PASSWORD = "e2e-password-123";

async function withEmptyHousehold(
  page: Page,
  context: import("@playwright/test").BrowserContext,
  baseURL: string,
  tag: string,
  locale: "en" | "sv",
  run: (client: Client, householdId: string) => Promise<void>,
) {
  await dismissCookieNotice(context, baseURL);
  const userId = `e2e-sd-user-${tag}`;
  const householdId = `e2e-sd-household-${tag}`;
  const email = `e2e-sd-${tag}@squirrel.test`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Sample Data', now(), $4)`,
      [userId, email, await bcrypt.hash(PASSWORD, 10), locale],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Sample data household')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [`e2e-sd-member-${tag}`, householdId, userId],
    );
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await run(client, householdId);
  } finally {
    // Household first: its members and rows cascade with it.
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
    await client.end();
  }
}

test("an empty household tries the sample data, sees rows, and clears only the sample", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const d = en.dashboard.sampleData;
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}-a`;
  await withEmptyHousehold(page, context, baseURL!, tag, "en", async (client, householdId) => {
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: d.tryTitle })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await main.getByRole("button", { name: d.tryButton }).click();

    // The overview now has rows: the way out replaces the offer, the pantry
    // counts, tonight's dinner or the week, and the open tasks.
    await expect(main.getByRole("heading", { name: d.clearTitle })).toBeVisible();
    await expect(main.getByRole("button", { name: d.tryButton })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    const count = async (table: string) =>
      Number((await client.query(`SELECT count(*) FROM "${table}" WHERE "householdId" = $1`, [householdId])).rows[0].count);
    expect(await count("InventoryItem")).toBe(6);
    expect(await count("Recipe")).toBe(3);
    expect(await count("ShoppingList")).toBe(1);
    expect(await count("HouseholdTask")).toBe(3);
    await page.goto("/dashboard/inventory");
    await expect(page.getByText(en.dashboard.sampleData.content.itemCoffee).filter({ visible: true }).first()).toBeVisible();

    // The person adds their own pantry row and their own task in the meantime.
    await client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
       VALUES ($1, $2, 'My own oats', 'Pantry', 3, 'pcs', now())`,
      [`e2e-sd-item-${tag}`, householdId],
    );
    await client.query(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, 'My own task')`, [
      `e2e-sd-task-${tag}`,
      householdId,
    ]);

    await page.goto("/dashboard");
    await main.getByRole("button", { name: d.clearButton }).click();

    // Cleared: the offer is gone too (the household is no longer empty), and
    // exactly the person's own rows are left.
    await expect(main.getByRole("heading", { name: d.clearTitle })).toHaveCount(0);
    expect(await count("InventoryItem")).toBe(1);
    expect(await count("Recipe")).toBe(0);
    expect(await count("ShoppingList")).toBe(0);
    expect(await count("HouseholdTask")).toBe(1);
    expect(await count("MealPlan")).toBe(0);
    await page.goto("/dashboard/inventory");
    await expect(page.getByText("My own oats").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(en.dashboard.sampleData.content.itemCoffee)).toHaveCount(0);
  });
});

test("clearing returns an untouched sample household to empty, and the offer comes back", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const d = en.dashboard.sampleData;
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}-b`;
  await withEmptyHousehold(page, context, baseURL!, tag, "en", async () => {
    const main = page.getByRole("main");
    await main.getByRole("button", { name: d.tryButton }).click();
    await expect(main.getByRole("heading", { name: d.clearTitle })).toBeVisible();
    await main.getByRole("button", { name: d.clearButton }).click();
    await expect(main.getByRole("heading", { name: d.tryTitle })).toBeVisible();
    await page.reload();
    await expect(main.getByRole("heading", { name: d.tryTitle })).toBeVisible();
  });
});

test("the sample data is offered and seeded in Swedish", async ({ page, context, baseURL }, testInfo) => {
  const d = sv.dashboard.sampleData;
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}-c`;
  await withEmptyHousehold(page, context, baseURL!, tag, "sv", async () => {
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: d.tryTitle })).toBeVisible();
    await main.getByRole("button", { name: d.tryButton }).click();
    await expect(main.getByRole("heading", { name: d.clearTitle })).toBeVisible();
    await page.goto("/dashboard/inventory");
    await expect(page.getByText(d.content.itemTomatoes).filter({ visible: true }).first()).toBeVisible();
  });
});
