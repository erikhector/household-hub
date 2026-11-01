import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow, expectOnePrimaryAction } from "./ui";

// UX-112: a member who has only just joined and has no personal categories
// yet still sees their share of a split bill, and what they owe, on the
// personal Overview, and what they owe on Home, instead of only "Let's set up
// your budget".
// Their shared-expense action is the quiet outline one (UX-153); the
// starter-set card's button is the page's primary. A fresh household and two accounts
// keep it independent of the seeded worker household, whose users collect
// personal categories from other specs.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a new member sees what they owe from a split dinner before setting up a budget", async ({ page }, testInfo) => {
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${testInfo.project.name}`;
  const payerId = `e2e-sc-payer-${tag}`;
  const newcomerId = `e2e-sc-new-${tag}`;
  const householdId = `e2e-sc-household-${tag}`;
  const payerMember = `e2e-sc-pm-${tag}`;
  const newcomerMember = `e2e-sc-nm-${tag}`;
  const email = `e2e-sc-${tag}@squirrel.test`;
  const password = "e2e-password-123";
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Paying Partner', now(), 'en'), ($4, $5, $3, 'New Member', now(), 'en')`,
      [payerId, `payer-${email}`, hash, newcomerId, email],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Villa Vinga')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role)
       VALUES ($1, $3, $4, 'OWNER'), ($2, $3, $5, 'CONTRIBUTOR')`,
      [payerMember, newcomerMember, householdId, payerId, newcomerId],
    );
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Dinner out', 'EXPENSE')`,
      [`e2e-sc-cat-${tag}`, householdId],
    );
    // A 940 dinner the partner paid in full, split evenly.
    await client.query(
      `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, description, date)
       VALUES ($1, $2, $3, 940, 'EXPENSE', 'Anniversary dinner', date_trunc('month', now()) + interval '1 day')`,
      [`e2e-sc-tx-${tag}`, householdId, `e2e-sc-cat-${tag}`],
    );
    await client.query(
      `INSERT INTO "TransactionSplit" (id, "transactionId", "householdMemberId", "amountOwed", "amountPaid")
       VALUES ($1, $3, $4, 470, 940), ($2, $3, $5, 470, 0)`,
      [`e2e-sc-sa-${tag}`, `e2e-sc-sb-${tag}`, `e2e-sc-tx-${tag}`, payerMember, newcomerMember],
    );

    // A 200 dinner from last month, to browse back to.
    await client.query(
      `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, description, date)
       VALUES ($1, $2, $3, 200, 'EXPENSE', 'Old dinner', date_trunc('month', now()) - interval '10 days')`,
      [`e2e-sc-tp-${tag}`, householdId, `e2e-sc-cat-${tag}`],
    );
    await client.query(
      `INSERT INTO "TransactionSplit" (id, "transactionId", "householdMemberId", "amountOwed", "amountPaid")
       VALUES ($1, $3, $4, 100, 200), ($2, $3, $5, 100, 0)`,
      [`e2e-sc-pa-${tag}`, `e2e-sc-pb-${tag}`, `e2e-sc-tp-${tag}`, payerMember, newcomerMember],
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const amount470 = /470[\s  ,.]?00/;
    // The balance is all-time: this month's 470 plus last month's 100.
    const amount570 = /570[\s  ,.]?00/;
    const main = page.getByRole("main");

    // Home (UX-HOME-4): the balance sits under the Safe to spend tiles,
    // whose "You" tile is the way to set up a budget. The month's share
    // lives on Personal budget.
    await expect(main.getByText("You owe other members").locator("..")).toContainText(amount570);
    await expect(main.getByRole("link", { name: "Settle up →" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Set up your personal budget" })).toBeVisible();

    // Personal Overview: same numbers, before any category exists.
    await page.goto("/dashboard/personal-budget");
    await expect(main.getByText("Shared with your household")).toBeVisible();
    await expect(main.getByText("Your share this month").locator("..")).toContainText(amount470);
    await expect(main.getByText("You owe other members").locator("..")).toContainText(amount570);
    await expect(main.getByText("Let's set up your budget")).toBeVisible();

    // A past month names itself instead of claiming "this month".
    const prev = new Date();
    prev.setDate(1);
    prev.setMonth(prev.getMonth() - 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    const prevLabel = prev.toLocaleDateString("en", { month: "long", year: "numeric" });
    await page.goto(`/dashboard/personal-budget?month=${prevKey}`);
    await expect(main.getByText(`Your share in ${prevLabel}`).locator("..")).toContainText(/100[\s  ,.]?00/);
    await expect(main.getByText("Your share this month")).toHaveCount(0);
    await page.goto("/dashboard/personal-budget");

    // The shared-expense action is the quiet outline one (UX-153), named like "Add transaction".
    await expect(main.getByRole("button", { name: "Add shared expense" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Log a shared expense" })).toHaveCount(0);
    // UX-153: with that button on screen, the starter-set card's is the one solid button.
    await expectOnePrimaryAction(page);
    await expectNoHorizontalOverflow(page);

    // The link lands on the Transactions tab, where the share is listed.
    await main.getByRole("link", { name: "See the shared expenses →" }).click();
    await expect(page).toHaveURL(/tab=transactions/);
    await expect(main.getByText("Shared", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  } finally {
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[payerId, newcomerId]]);
    await client.end();
  }
});
