import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-110: the two first-run cards say whose money each budget holds, so
// "my salary" has an obvious home. (The phone-only purpose line under each
// title is asserted in budget-chrome.mobile.spec.ts.) A brand-new account
// with no categories gets its own household (like overview-greeting.spec.ts),
// because the seeded worker household collects categories from other specs
// and would no longer show the onboarding state.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("the first-run cards say whose money each budget holds", async ({ page }, testInfo) => {
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${testInfo.project.name}`;
  const userId = `e2e-bp-user-${tag}`;
  const householdId = `e2e-bp-household-${tag}`;
  const email = `e2e-bp-${tag}@squirrel.test`;
  const password = "e2e-password-123";
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Purpose Tester', now(), 'en')`,
      [userId, email, await bcrypt.hash(password, 10)],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Villa Vinga')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [`e2e-bp-member-${tag}`, householdId, userId],
    );
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const main = page.getByRole("main");
    await page.goto("/dashboard/budget");
    await expect(main.getByText("Let's set up your budget")).toBeVisible();
    await expect(main.getByText(/Shared money for Villa Vinga: rent, food, bills\. Add a category/)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto("/dashboard/personal-budget");
    await expect(main.getByText("Let's set up your budget")).toBeVisible();
    await expect(
      main.getByText(/Money that's only yours — no one else in the household sees it\./).first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } finally {
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
    await client.end();
  }
});
