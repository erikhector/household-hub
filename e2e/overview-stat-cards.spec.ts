import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-71: the overview's three household cards tell the truth about their
// numbers and every one of them leads somewhere. Own account and household
// (like overview.spec.ts) so the counts are exactly what this test inserts.

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test.describe("the household stat cards", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("read honestly when empty and link to where the numbers live", async ({ page }, testInfo) => {
    const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
    const userId = `e2e-sc-user-${tag}`;
    const householdId = `e2e-sc-household-${tag}`;
    const email = `e2e-sc-${tag}@squirrel.test`;
    const password = "e2e-password-123";

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
         VALUES ($1, $2, $3, 'Cards', now(), 'en')`,
        [userId, email, await bcrypt.hash(password, 10)],
      );
      await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Cards household')`, [householdId]);
      await client.query(
        `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
        [`e2e-sc-member-${tag}`, householdId, userId],
      );

      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);

      const main = page.getByRole("main");
      const card = (title: string) =>
        main.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) });

      // Nothing yet: friendly copy and a way forward, no "0" in warning amber.
      await expect(card("Low stock items").getByText("All stocked up")).toBeVisible();
      await expect(card("Low stock items").locator("svg").first()).toBeVisible();
      await expect(card("Shopping lists").getByText("No lists yet — start one")).toBeVisible();
      await expect(card("Shopping lists").getByRole("button", { name: "Start a list" })).toBeVisible();
      await expect(card("Total items tracked").getByText("Nothing tracked yet")).toBeVisible();
      await expect(card("Total items tracked").getByRole("button", { name: "Add your first item" })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // One low item (already on the list), one out of stock, one list.
      await client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "lowStockThreshold", "updatedAt")
         VALUES ($1, $2, 'Flour', 'Pantry', 1, 'kg', 2, now()), ($3, $2, 'Salt', 'Pantry', 0, 'kg', 1, now())`,
        [`e2e-sc-flour-${tag}`, householdId, `e2e-sc-salt-${tag}`],
      );
      await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, 'Weekly')`, [
        `e2e-sc-list-${tag}`,
        householdId,
      ]);
      await client.query(
        `INSERT INTO "ShoppingListItem" (id, "shoppingListId", "inventoryItemId", name)
         VALUES ($1, $2, $3, 'Flour')`,
        [`e2e-sc-row-${tag}`, `e2e-sc-list-${tag}`, `e2e-sc-flour-${tag}`],
      );
      await page.reload();

      const low = card("Low stock items");
      await expect(low.getByText("All stocked up")).toHaveCount(0);
      await expect(low.getByText("1 out of stock")).toBeVisible();
      await expect(low.getByText("1 already on your list")).toBeVisible();
      await expect(low.getByRole("button", { name: "View inventory" })).toBeVisible();
      await low.getByRole("button", { name: "View inventory" }).click();
      await expect(page).toHaveURL(/\/dashboard\/inventory\?status=low/);

      await page.goto("/dashboard");
      // One active list: the card opens it, not the index.
      await card("Shopping lists").getByRole("button", { name: "Open Weekly" }).click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/shopping-list/e2e-sc-list-${tag}$`));

      await page.goto("/dashboard");
      await card("Total items tracked").getByRole("button", { name: "Browse all items" }).click();
      await expect(page).toHaveURL(/\/dashboard\/inventory$/);
    } finally {
      await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
      await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
      await client.end();
    }
  });
});
