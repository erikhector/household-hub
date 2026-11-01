import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow, setLocaleCookie } from "./ui";

// Home's Safe to spend tiles: a long household amount with its currency
// ("−36 692,00 kr" in Swedish) used to wrap mid-word on a phone, with "k"
// and "r" on separate lines, because the half-width tile was narrower than
// the amount at text-2xl. The amount now sizes itself to its tile, so it
// stays on one line at every width. Own account and household (straight to
// Postgres), like safe-to-spend-unset.spec.ts, so no other spec's
// transactions change the figure.

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a long household amount with its currency stays on one line in its tile", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
  const ids = {
    user: `e2e-fit-user-${tag}`,
    household: `e2e-fit-household-${tag}`,
    member: `e2e-fit-member-${tag}`,
    income: `e2e-fit-income-${tag}`,
    expense: `e2e-fit-expense-${tag}`,
    email: `e2e-fit-${tag}@squirrel.test`,
  };
  const password = "e2e-password-123";
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Fit', now(), 'sv')`,
      [ids.user, ids.email, await bcrypt.hash(password, 10)],
    );
    await client.query(`INSERT INTO "Household" (id, name, "currencyCode") VALUES ($1, 'Fit household', 'SEK')`, [
      ids.household,
    ]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [ids.member, ids.household, ids.user],
    );
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type)
       VALUES ($1, $3, 'Lön', 'INCOME'), ($2, $3, 'Renovering', 'EXPENSE')`,
      [ids.income, ids.expense, ids.household],
    );
    // 1 000 in, 37 692 out this month: −36 692,00 kr left to spend.
    await client.query(
      `INSERT INTO "Transaction" (id, "householdId", "categoryId", amount, type, date)
       VALUES ($1, $3, $1, 1000, 'INCOME', now()), ($2, $3, $2, 37692, 'EXPENSE', now())`,
      [ids.income, ids.expense, ids.household],
    );

    // 375 px, the narrowest iPhone still common: at the mobile project's
    // 412 px the old text-2xl amount happened to just fit.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/login");
    await page.getByLabel("Email").fill(ids.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await setLocaleCookie(context, baseURL!, "sv");
    await page.reload();

    const money = page
      .getByRole("main")
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole("heading", { name: "Säkert att spendera", exact: true }) });
    const amount = money.getByText(/36\s692,00\s*kr/);
    await expect(amount).toBeVisible();

    // One line: no taller than one line box, and nothing clipped sideways.
    const fit = await amount.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(style.lineHeight),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });
    expect(fit.height).toBeLessThan(fit.lineHeight * 1.5);
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth);
    await expectNoHorizontalOverflow(page);
  } finally {
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [ids.household]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [ids.user]);
    await client.end();
  }
});
