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

  test("keeps finished steps as ticked rows under a progress bar, can be hidden, and stays hidden", async ({ page }, testInfo) => {
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
      // household, plan meals.
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
      await expect(card.getByRole("progressbar", { name: "3 of 5 done" })).toHaveAttribute("aria-valuenow", "3");
      // UX-69: every step is a row with a chevron; the finished ones stay, ticked.
      await expect(card.getByRole("link", { name: /Invite your household/ })).toBeVisible();
      await expect(card.getByRole("link", { name: /Plan this week's meals/ })).toBeVisible();
      await expect(card.getByRole("link", { name: /Add what's in the pantry \(Done\)/ })).toBeVisible();
      await expect(card.getByRole("link", { name: /Start a shopping list \(Done\)/ })).toBeVisible();
      await expect(card.getByRole("link", { name: /Set up your household budget \(Done\)/ })).toBeVisible();
      await expect(card.locator("svg.lucide-chevron-right")).toHaveCount(5);
      // One prompt per feature: the personal budget has its own card below.
      await expect(card.getByText("Track your personal budget")).toHaveCount(0);
      expect(
        await card
          .getByText("Bring in the people you share this home with")
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(14);
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

test.describe("the finish moment (UX-69)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows 'You're all set' once when the last step is done, without animation under reduced motion", async ({
    page,
  }, testInfo) => {
    const tag = `${Date.now().toString(36)}-fin-${testInfo.project.name}`;
    const userId = `e2e-fin-user-${tag}`;
    const householdId = `e2e-fin-household-${tag}`;
    const email = `e2e-fin-${tag}@squirrel.test`;
    const password = "e2e-password-123";

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
         VALUES ($1, $2, $3, 'Finish', now(), 'en')`,
        [userId, email, await bcrypt.hash(password, 10)],
      );
      await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Finish household')`, [householdId]);
      await client.query(
        `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
        [`e2e-fin-member-${tag}`, householdId, userId],
      );
      await client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
         VALUES ($1, $2, 'Rice', 'Pantry', 1, 'kg', now())`,
        [`e2e-fin-item-${tag}`, householdId],
      );
      await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, 'Weekly')`, [
        `e2e-fin-list-${tag}`,
        householdId,
      ]);
      await client.query(
        `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Food', 'EXPENSE')`,
        [`e2e-fin-cat-${tag}`, householdId],
      );

      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);

      const main = page.getByRole("main");
      // Skip the household step; the meal plan is the last one open.
      await main.getByRole("button", { name: "Skip this step" }).click();
      await expect(main.getByText("4 of 5 done")).toBeVisible();

      await client.query(`INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, now())`, [
        `e2e-fin-plan-${tag}`,
        householdId,
      ]);
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName")
         VALUES ($1, $2, now(), 'DINNER', 'Soup')`,
        [`e2e-fin-entry-${tag}`, `e2e-fin-plan-${tag}`],
      );
      await page.reload();

      const heading = main.getByRole("heading", { name: "You're all set" });
      await expect(heading).toBeVisible();
      await expect(main.getByRole("img", { name: "Squirrel mascot" })).toBeVisible();
      await expect(main.getByRole("heading", { name: "Get set up" })).toHaveCount(0);
      const card = main.locator('[data-slot="card"]').filter({
        has: page.getByRole("heading", { name: "You're all set" }),
      });
      expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
      await expectNoHorizontalOverflow(page);

      // Once: the next visit finds neither the moment nor the card.
      await page.reload();
      await expect(main.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expect(heading).toHaveCount(0);
      await expect(main.getByRole("heading", { name: "Get set up" })).toHaveCount(0);
    } finally {
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
  const shopping = main.getByRole("button", { name: /View shopping lists|Open |Start a list/ });
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

test("Create household is the last item of the switcher dropdown, not a header +", async ({ page }, testInfo) => {
  // UX-46. On phones the switcher is in the top header; on desktop, the
  // expanded sidebar. Neither shows a standalone "+" any more.
  await page.goto("/dashboard");
  const row = testInfo.project.name === "mobile" ? page.getByRole("banner") : page.getByRole("complementary");
  await expect(row.getByRole("button", { name: "Create household" })).toHaveCount(0);

  await row.getByRole("button", { name: /E2E Household/ }).click();
  const items = page.getByRole("menu").getByRole("menuitem");
  await expect(items.last()).toHaveText("Create household");

  await items.last().click();
  const dialog = page.getByRole("dialog", { name: "Create a new household" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Household name")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
