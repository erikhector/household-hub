import { expect, test, type Locator } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow, gotoRevealed } from "./ui";

// UX-26 / UX-HOME-4: setup leads Home only in a household's first days (at
// most two steps done); after that it is a one-line strip below the cards,
// and the first screen shows today.

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
// so this test gets its own account and household with exactly two of the
// five steps done (then three) (straight to Postgres and logged in through the real
// form, like quick-add-unit.spec.ts). A fresh context, or /login would
// bounce to the dashboard.
test.describe("the setup card", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("keeps finished steps as ticked rows under a progress bar, shrinks to a strip, can be hidden, and stays hidden", async ({ page }, testInfo) => {
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
      // Done: pantry, household budget. Open: invite the household, start
      // a shopping list, plan meals.
      await client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "updatedAt")
         VALUES ($1, $2, 'Rice', 'Pantry', 1, 'kg', now())`,
        [`e2e-ov-item-${tag}`, householdId],
      );
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
      await expect(card.getByText("2 of 5 done")).toBeVisible();
      await expect(card.getByRole("progressbar", { name: "2 of 5 done" })).toHaveAttribute("aria-valuenow", "2");
      // UX-69: every step is a row with a chevron; the finished ones stay, ticked.
      await expect(card.getByRole("link", { name: /Invite your household/ })).toBeVisible();
      await expect(card.getByRole("link", { name: /Plan this week's meals/ })).toBeVisible();
      await expect(card.getByRole("link", { name: /Add what's in the pantry \(Done\)/ })).toBeVisible();
      await expect(card.getByRole("link", { name: /^Start a shopping list(?! \(Done\))/ })).toBeVisible();
      await expect(card.getByRole("link", { name: /Set up your household budget \(Done\)/ })).toBeVisible();
      await expect(card.locator("svg.lucide-chevron-right")).toHaveCount(5);
      // One prompt per feature: the personal budget has its "You" tile.
      await expect(card.getByText("Track your personal budget")).toHaveCount(0);
      expect(
        await card
          .getByText("Bring in the people you share this home with")
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(14);
      // In the first days setup is the one job, so it leads the page.
      await expect(main.getByRole("heading", { name: "Get set up" })).toBeInViewport();
      expect((await box(card)).y).toBeLessThan(
        (await box(main.getByRole("heading", { name: "Today", exact: true }))).y,
      );
      await expectNoHorizontalOverflow(page);

      // UX-152: at 200% text the step cards stack (icon above the text,
      // chevron hidden) so a title takes at most two lines and no card is
      // over half the screen. Default size was asserted above, unchanged.
      if (testInfo.project.name === "mobile") {
        // The acceptance is measured on the Pixel 7 screen, not the small
        // first-screen viewport used above.
        await page.setViewportSize({ width: 412, height: 915 });
        await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        const steps = card.getByRole("link");
        expect(await steps.count()).toBe(5);
        for (const step of await steps.all()) {
          const [box, lines] = await Promise.all([
            step.boundingBox(),
            step.locator("p.font-medium").evaluate((el) => {
              const lh = parseFloat(getComputedStyle(el).lineHeight);
              return Math.round(el.getBoundingClientRect().height / lh);
            }),
          ]);
          expect(lines, "step title lines at 200% text").toBeLessThanOrEqual(2);
          expect(box!.height, "step card height at 200% text").toBeLessThan(915 / 2);
        }
        await expectNoHorizontalOverflow(page);
        await page.addStyleTag({ content: "html { font-size: 100% !important; }" });
      }

      // A third step done (skipping the household one): the card shrinks to
      // a strip under the cards, naming the next step, and Today is on the
      // first screen.
      await card.getByRole("button", { name: "Skip this step" }).click();
      await expect(main.getByRole("heading", { name: "Get set up" })).toHaveCount(0);
      await page.reload();
      const strip = main.locator('[data-slot="card"]').filter({ has: page.getByText("3 of 5 set up") });
      await expect(strip.getByRole("progressbar", { name: "3 of 5 set up" })).toHaveAttribute("aria-valuenow", "3");
      await expect(strip.getByRole("link", { name: /Next: Start a shopping list/ })).toHaveAttribute(
        "href",
        "/dashboard/shopping-list",
      );
      await expect(main.getByRole("heading", { name: "Today", exact: true })).toBeInViewport();
      expect((await box(strip)).y).toBeGreaterThan(
        (await box(main.getByRole("heading", { name: "Today", exact: true }))).y,
      );
      await expectNoHorizontalOverflow(page);

      await strip.getByRole("button", { name: "Hide the setup card" }).click();
      await expect(main.getByText("3 of 5 set up")).toHaveCount(0);
      await expect(main.getByRole("heading", { name: "Get set up" })).toHaveCount(0);
      await page.reload();
      await expect(main.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expect(main.getByRole("heading", { name: "Get set up" })).toHaveCount(0);
      await expect(main.getByText("3 of 5 set up")).toHaveCount(0);
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
    const otherUserId = `e2e-fin-other-${tag}`;
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

      await client.query(`INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, now())`, [
        `e2e-fin-plan-${tag}`,
        householdId,
      ]);
      await client.query(
        `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName")
         VALUES ($1, $2, now(), 'DINNER', 'Soup')`,
        [`e2e-fin-entry-${tag}`, `e2e-fin-plan-${tag}`],
      );

      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);

      const main = page.getByRole("main");
      // Four of five: the strip, with inviting the household the last step.
      await expect(main.getByText("4 of 5 set up")).toBeVisible();
      await expect(main.getByText("Next: Invite your household")).toBeVisible();

      await client.query(
        `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
         VALUES ($1, $2, 'x', 'Other', now(), 'en')`,
        [otherUserId, `e2e-fin-other-${tag}@squirrel.test`],
      );
      await client.query(
        `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'CONTRIBUTOR')`,
        [`e2e-fin-omember-${tag}`, householdId, otherUserId],
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

      // Once: the next visit finds neither the moment nor the card. The
      // cookie is set by a server action fired on mount, so wait for it
      // before reloading.
      await expect
        .poll(async () => (await page.context().cookies()).some((c) => c.name.startsWith("getting_started_done_")))
        .toBe(true);
      await page.reload();
      await expect(main.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expect(heading).toHaveCount(0);
      await expect(main.getByRole("heading", { name: "Get set up" })).toHaveCount(0);
      await expect(main.getByText("4 of 5 set up")).toHaveCount(0);
    } finally {
      await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
      await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[userId, otherUserId]]);
      await client.end();
    }
  });
});

test("Home puts Today beside the other cards on a wide screen and above them on a phone", async ({ page }) => {
  await gotoRevealed(page, "/dashboard");
  const main = page.getByRole("main");
  const heading = (name: string) => main.getByRole("heading", { name, exact: true });
  await expect(heading("Shopping & pantry")).toBeVisible();
  const [today, pantry, viewport] = [
    await box(heading("Today")),
    await box(heading("Shopping & pantry")),
    page.viewportSize()!,
  ];
  if (viewport.width >= 1024) {
    // Two columns from lg: doing on the left, checking on the right.
    expect(pantry.x).toBeGreaterThan(today.x + today.width);
    expect(Math.abs(pantry.y - today.y)).toBeLessThanOrEqual(1);
  } else {
    // One column on a phone, in the order Today, Shopping & pantry.
    expect(pantry.y).toBeGreaterThan(today.y);
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
