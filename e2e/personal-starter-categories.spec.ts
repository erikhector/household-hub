import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// BUDGET-5: a fresh personal budget offers a short personal starter set
// (not the household's rent and groceries) through the same one-click picker
// as household onboarding; picking two creates exactly those two and the
// first-run card goes away. A brand-new account gets its own household
// (like budget-purpose.spec.ts), since the seeded worker household's users
// collect personal categories from other specs.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("picking two starter categories on a fresh personal budget creates them and the picker goes away", async ({
  page,
}, testInfo) => {
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${testInfo.project.name}`;
  const userId = `e2e-psc-user-${tag}`;
  const householdId = `e2e-psc-household-${tag}`;
  const email = `e2e-psc-${tag}@squirrel.test`;
  const password = "e2e-password-123";
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Starter Tester', now(), 'en')`,
      [userId, email, await bcrypt.hash(password, 10)],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Villa Vinga')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [`e2e-psc-member-${tag}`, householdId, userId],
    );
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const main = page.getByRole("main");
    await page.goto("/dashboard/personal-budget");
    await expect(main.getByText("Let's set up your budget")).toBeVisible();
    await expect(main.getByText("Or add a starter set")).toBeVisible();
    // The personal set, not the household one.
    await expect(main.getByRole("button", { name: "Fun money" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Rent" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // All six start selected; keep Salary and Eating out.
    for (const name of ["Subscriptions", "Clothes", "Fun money", "Savings"]) {
      await main.getByRole("button", { name, exact: true }).click();
    }
    await main.getByRole("button", { name: "Add 2 categories" }).click();

    await expect(main.getByText("Let's set up your budget")).toHaveCount(0);
    await expect(main.getByText("Or add a starter set")).toHaveCount(0);

    await page.reload();
    await expect(main.getByText("Let's set up your budget")).toHaveCount(0);
    const rows = await client.query(
      `SELECT name FROM "PersonalBudgetCategory" WHERE "userId" = $1 ORDER BY name`,
      [userId],
    );
    expect(rows.rows.map((r: { name: string }) => r.name)).toEqual(["Eating out", "Salary"]);
  } finally {
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
    await client.end();
  }
});
