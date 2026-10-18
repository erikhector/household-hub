import { expect, test, type Locator } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-26: the overview's first screen shows today, not the setup card.

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no layout box");
  return b;
}

// The setup card's content depends on what the household has done, and the
// seeded household's budgets get categories from other specs as they run,
// so this test gets its own account and household with exactly three of
// the five steps done (straight to Postgres and logged in through the real
// form, like quick-add-unit.spec.ts). A fresh context, or /login would
// bounce to the dashboard.
test.describe("the setup card", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("collapses finished steps, can be hidden, and stays hidden", async ({ page }, testInfo) => {
    const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
    const userId = `e2e-ov-user-${tag}`;
    const householdId = `e2e-ov-household-${tag}`;
    const email = `e2e-ov-${tag}@squirrel.test`;
    const password = "e2e-password-123";

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
         VALUES ($1, $2, $3, 'Overview', now(), 'en')`,
        [userId, email, await bcrypt.hash(password, 10)],
      );
      await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Overview household')`, [householdId]);
      await client.query(
        `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
        [`e2e-ov-member-${tag}`, householdId, userId],
      );
      // Done: pantry, shopping list, household budget. Open: invite the
      // household, personal budget.
      await client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
         VALUES ($1, $2, 'Rice', 'Pantry', 1, 'kg', now())`,
        [`e2e-ov-item-${tag}`, householdId],
      );
      await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, 'Weekly')`, [
        `e2e-ov-list-${tag}`,
        householdId,
      ]);
      await client.query(
        `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Food', 'EXPENSE')`,
        [`e2e-ov-cat-${tag}`, householdId],
      );

      // An iPhone SE's screen on the phone run, where the card used to fill
      // the whole first screen.
      if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 375, height: 667 });

      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);

      const main = page.getByRole("main");
      const card = main.locator('[data-slot="card"]').filter({
        has: page.getByRole("heading", { name: "Get set up" }),
      });
      await expect(card.getByText("3 of 5 done")).toBeVisible();
      // Only the open steps are listed; the finished ones are just counted.
      await expect(card.getByRole("link", { name: /Invite your household/ })).toBeVisible();
      await expect(card.getByRole("link", { name: /Track your personal budget/ })).toBeVisible();
      await expect(card.getByText("Add what's in the pantry")).toHaveCount(0);
      await expect(card.getByText("Start a shopping list")).toHaveCount(0);
      await expect(card.getByText("Set up your household budget")).toHaveCount(0);
      // Today now sits above the card (UX-70) and is on the first screen.
      await expect(main.getByRole("heading", { name: "Today", exact: true })).toBeInViewport();
      await expectNoHorizontalOverflow(page);

      await card.getByRole("button", { name: "Hide the setup card" }).click();
      await expect(main.getByRole("heading", { name: "Get set up" })).toHaveCount(0);
      await page.reload();
      await expect(main.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expect(main.getByRole("heading", { name: "Get set up" })).toHaveCount(0);
    } finally {
      // Household first: its members, items, lists and categories cascade.
      await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
      await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
      await client.end();
    }
  });
});

test("the overview's card buttons line up and keep their chevron inside", async ({ page }, testInfo) => {
  // An iPad's portrait width on the desktop run: the sidebar is open and the
  // household cards sit three to a row, which is where "View shopping lists"
  // used to push its chevron onto the card's border.
  if (testInfo.project.name === "desktop") await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/dashboard");
  const main = page.getByRole("main");
  const inventory = main.getByRole("button", { name: "View inventory" });
  const shopping = main.getByRole("button", { name: "View shopping lists" });
  await expect(shopping).toBeVisible();

  const [inv, shop] = [await box(inventory), await box(shopping)];
  if (Math.abs(inv.x - shop.x) > 1) {
    // Side by side: both sit at the foot of their cards, at the same height.
    expect(Math.abs(inv.y + inv.height - (shop.y + shop.height))).toBeLessThanOrEqual(1);
  }
  for (const link of [inventory, shopping]) {
    const [outer, chevron] = [await box(link), await box(link.locator("svg"))];
    expect(chevron.x + chevron.width).toBeLessThanOrEqual(outer.x + outer.width);
  }
  await expectNoHorizontalOverflow(page);
});

test("the household switcher's + sits at the right edge of its row", async ({ page }, testInfo) => {
  await page.goto("/dashboard");
  // On phones it's in the top header; on desktop, the expanded sidebar.
  const row = testInfo.project.name === "mobile" ? page.getByRole("banner") : page.getByRole("complementary");
  const plus = row.getByRole("button", { name: "Create household" });
  await expect(plus).toBeVisible();
  const [outer, button] = [await box(row), await box(plus)];
  // Flush with the row's right padding (px-4 header, px-2 sidebar), not
  // wherever the household name ends.
  expect(outer.x + outer.width - (button.x + button.width)).toBeLessThanOrEqual(17);
  // The household's own button still starts at the left.
  const trigger = row.getByRole("button", { name: /E2E Household/ });
  expect((await box(trigger)).x).toBeLessThan(outer.x + 24);
});
