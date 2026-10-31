import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-70: Home's first screen answers "what needs me now?" with a Today
// block: tonight's dinner and your tasks plus the unassigned ones ("Anyone",
// each with a working tick). Since the Home redesign (UX-HOME-2/4) the
// household's safe to spend is a tile in the Safe to spend card and the
// expiring items are Shopping & pantry's "Use soon" chips; this checks they
// still show beside it on the first screen. The block's contents
// depend on the household's data, and other specs fill the seeded household
// as they run, so this gets its own accounts and household (straight to
// Postgres, logged in through the real form, like overview.spec.ts).

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const DAY_MS = 24 * 60 * 60 * 1000;

test("the Today block lists tonight and my and unassigned tasks, beside safe to spend and Use soon", async ({
  page,
}, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
  const userId = `e2e-td-user-${tag}`;
  const otherUserId = `e2e-td-other-${tag}`;
  const householdId = `e2e-td-household-${tag}`;
  const memberId = `e2e-td-member-${tag}`;
  const otherMemberId = `e2e-td-omember-${tag}`;
  const email = `e2e-td-${tag}@squirrel.test`;
  const password = "e2e-password-123";
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS);
  // Mid-month noon in local time, so the transactions land in this month
  // whatever day (and time zone) the suite runs.
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Today', now(), 'en'), ($4, $5, $3, 'Other', now(), 'en')`,
      [userId, email, hash, otherUserId, `e2e-td-other-${tag}@squirrel.test`],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Today household')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role)
       VALUES ($1, $2, $3, 'OWNER'), ($4, $2, $5, 'CONTRIBUTOR')`,
      [memberId, householdId, userId, otherMemberId, otherUserId],
    );
    await client.query(
      `INSERT INTO "HouseholdTask" (id, "householdId", title, "assignedToMemberId", "completedAt", "createdAt")
       VALUES ($1, $5, 'Water the plants', $6, NULL, now() - interval '3 minutes'),
              ($2, $5, 'Take out the recycling', NULL, NULL, now() - interval '2 minutes'),
              ($3, $5, 'Clean the oven', $7, NULL, now() - interval '1 minutes'),
              ($4, $5, 'Already done chore', $6, now(), now())`,
      [
        `e2e-td-t1-${tag}`,
        `e2e-td-t2-${tag}`,
        `e2e-td-t3-${tag}`,
        `e2e-td-t4-${tag}`,
        householdId,
        memberId,
        otherMemberId,
      ],
    );
    await client.query(`INSERT INTO "MealPlan" (id, "householdId", "weekStartDate") VALUES ($1, $2, $3)`, [
      `e2e-td-plan-${tag}`,
      householdId,
      monday,
    ]);
    await client.query(
      `INSERT INTO "MealPlanEntry" (id, "mealPlanId", date, "mealType", "freeformName")
       VALUES ($1, $2, $3, 'DINNER', 'Lentil soup'), ($4, $2, $3, 'LUNCH', 'Cold lunch sandwich')`,
      [`e2e-td-meal-${tag}`, `e2e-td-plan-${tag}`, today, `e2e-td-lunch-${tag}`],
    );
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type)
       VALUES ($1, $3, 'Pay', 'INCOME'), ($2, $3, 'Food', 'EXPENSE')`,
      [`e2e-td-cat-i-${tag}`, `e2e-td-cat-e-${tag}`, householdId],
    );
    await client.query(
      `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, date)
       VALUES ($1, $3, $4, 1000, 'INCOME', $6), ($2, $3, $5, 250, 'EXPENSE', $6)`,
      [`e2e-td-tx-i-${tag}`, `e2e-td-tx-e-${tag}`, householdId, `e2e-td-cat-i-${tag}`, `e2e-td-cat-e-${tag}`, thisMonth],
    );
    await client.query(
      `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "expiresAt", "updatedAt")
       VALUES ($1, $3, 'Milk', 'Dairy', 1, 'l', now() + interval '1 day', now()),
              ($2, $3, 'Rice', 'Pantry', 1, 'kg', now() + interval '300 days', now())`,
      [`e2e-td-item-a-${tag}`, `e2e-td-item-b-${tag}`, householdId],
    );

    // The size the item names: Pixel 7's width, an iPhone-ish height.
    if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 412, height: 839 });

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Today", exact: true })).toBeInViewport();

    // My task and the unassigned one are there, the other member's and the
    // finished ones aren't.
    const mine = main.getByRole("checkbox", { name: "Mark Water the plants as done" });
    const shared = main.getByRole("checkbox", { name: "Mark Take out the recycling as done" });
    await expect(mine).toBeInViewport();
    await expect(shared).toBeInViewport();
    await expect(main.getByText("Anyone", { exact: true })).toBeVisible();
    await expect(main.getByText("Clean the oven")).toHaveCount(0);
    await expect(main.getByText("Already done chore")).toHaveCount(0);

    // Tonight's dinner (not lunch) as the hero line. A freeform meal has no
    // recipe, so nothing to cook from and no portions.
    await expect(main.getByRole("heading", { name: "Tonight", exact: true })).toBeInViewport();
    await expect(main.getByText("Lentil soup", { exact: true })).toBeInViewport();
    await expect(main.getByText("Cold lunch sandwich")).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Start cooking" })).toHaveCount(0);
    // The household's safe to spend, with its status in words, and the one
    // item about to expire (not the rice), each in its own card.
    const safe = main.getByRole("link", { name: /Household\s*.*750[.,]00\s*On track/ });
    await expect(safe).toBeVisible();
    // No personal budget yet: the "You" tile is the way to set one up.
    await expect(main.getByRole("link", { name: "Set up your personal budget" })).toBeVisible();
    await expect(main.getByRole("link", { name: /Milk\s*· tomorrow/ })).toBeVisible();
    await expect(main.getByRole("link", { name: /Rice/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // The tick works: it shows at once, and survives a reload because the
    // task was really completed.
    await mine.check();
    const ticked = main.getByRole("checkbox", { name: "Mark Water the plants as not done" });
    await expect(ticked).toBeChecked();
    const completed = async () => {
      const { rows } = await client.query(`SELECT "completedAt" FROM "HouseholdTask" WHERE id = $1`, [
        `e2e-td-t1-${tag}`,
      ]);
      return rows[0]?.completedAt !== null;
    };
    await expect.poll(completed).toBe(true);
    // The save has revalidated the page, so the server list no longer holds
    // the task: the row stays, struck through (M5).
    await expect(ticked).toBeChecked();
    await expect(main.getByText("Water the plants")).toHaveClass(/line-through/);
    // Unticking keeps it too, unstruck, while the un-complete save runs and
    // after the task is back in the server list.
    await ticked.uncheck();
    const unticked = main.getByRole("checkbox", { name: "Mark Water the plants as done" });
    await expect(unticked).not.toBeChecked();
    await expect(main.getByText("Water the plants")).not.toHaveClass(/line-through/);
    await expect.poll(completed).toBe(false);
    await expect(main.getByText("Water the plants")).toHaveCount(1);
    await unticked.check();
    await expect.poll(completed).toBe(true);
    await page.reload();
    await expect(main.getByText("Water the plants")).toHaveCount(0);
    await expect(main.getByText("Take out the recycling")).toBeVisible();
  } finally {
    // Household first: its members, tasks, plan, items and budget cascade.
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[userId, otherUserId]]);
    await client.end();
  }
});

test("without a budget or expiring items Home shows tasks, Plan dinner and no Safe to spend", async ({ page }, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}-quiet`;
  const userId = `e2e-tq-user-${tag}`;
  const householdId = `e2e-tq-household-${tag}`;
  const email = `e2e-tq-${tag}@squirrel.test`;
  const password = "e2e-password-123";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Quiet', now(), 'en')`,
      [userId, email, await bcrypt.hash(password, 10)],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Quiet household')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [`e2e-tq-member-${tag}`, householdId, userId],
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const main = page.getByRole("main");
    // An empty household: setup leads the page (UX-HOME-4), Today follows.
    await expect(main.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(main.getByText("No open tasks. Nice work!")).toBeVisible();
    await expect(main.getByText("Nothing planned yet.")).toBeVisible();
    await expect(main.getByRole("link", { name: "Plan dinner" })).toHaveAttribute("href", "/dashboard/meal-planning");
    await expect(main.getByRole("heading", { name: "Safe to spend" })).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Use soon" })).toHaveCount(0);
  } finally {
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
    await client.end();
  }
});
