import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-154: a household with a budget category but no income has nothing to
// judge a balance against. Home's Safe to spend card must not print 0.00 in
// `success` green ("On track"), and Insights must not show a planned
// "0.00 in, 0.00 out" with a green "room in the budget": both say the budget
// isn't set up and link to adding income. Own account and household (straight
// to Postgres), like home.spec.ts, so no other spec's income leaks in.

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a budget with a category and no income reads as not set up, not as green", async ({ page }, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
  const ids = {
    user: `e2e-un-user-${tag}`,
    household: `e2e-un-household-${tag}`,
    member: `e2e-un-member-${tag}`,
    category: `e2e-un-cat-${tag}`,
    email: `e2e-un-${tag}@squirrel.test`,
  };
  const password = "e2e-password-123";
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Unset', now(), 'en')`,
      [ids.user, ids.email, await bcrypt.hash(password, 10)],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Unset household')`, [ids.household]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [ids.member, ids.household, ids.user],
    );
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Groceries', 'EXPENSE')`,
      [ids.category, ids.household],
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(ids.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Home: the Household tile says so, in muted text, with no amount and no
    // status colour anywhere in the Safe to spend card.
    const main = page.getByRole("main");
    const money = main
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole("heading", { name: "Safe to spend", exact: true }) });
    const tile = money.getByRole("link", { name: /Household\s*Budget not set up yet/ });
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute("href", /\/dashboard\/budget\?tab=transactions/);
    await expect(money.getByText("On track")).toHaveCount(0);
    await expect(money.getByText(/0[.,]00/)).toHaveCount(0);
    await expect(money.locator(".text-success")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // Insights: one sentence and the add-income action, no zero totals.
    await page.goto("/dashboard/budget?tab=insights");
    const fixed = main
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole("heading", { name: "Fixed income & costs", exact: true }) });
    await expect(fixed.getByText(/Nothing planned yet/)).toBeVisible();
    await expect(fixed.getByRole("link", { name: "Add income" })).toBeVisible();
    await expect(fixed.getByText("That leaves room in the budget.")).toHaveCount(0);
    await expect(fixed.getByText(/0[.,]00/)).toHaveCount(0);
    await expect(fixed.locator(".text-success")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  } finally {
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [ids.household]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [ids.user]);
    await client.end();
  }
});
