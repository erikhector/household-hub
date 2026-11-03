import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-178: "Split with household" is a switch in Personal Budget's Add
// transaction sheet, not a second "Add shared expense" button beside the tabs.
// It logs the same household transaction LogSharedExpenseDialog did: paid by
// you, split evenly until Change, listed on the household budget and owed by
// the other member. A fresh household and two accounts keep it independent of
// the seeded worker household, whose users collect personal categories from
// other specs.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a split expense logged from the Add transaction sheet reaches the household budget and the other member's debt", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${testInfo.project.name}`;
  const payerId = `e2e-s178-payer-${tag}`;
  const otherId = `e2e-s178-other-${tag}`;
  const householdId = `e2e-s178-household-${tag}`;
  const payerEmail = `e2e-s178-payer-${tag}@squirrel.test`;
  const otherEmail = `e2e-s178-other-${tag}@squirrel.test`;
  const password = "e2e-password-123";
  const description = `Pizza night ${tag}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Payer Pat', now(), 'en'), ($4, $5, $3, 'Other Olle', now(), 'en')`,
      [payerId, payerEmail, hash, otherId, otherEmail],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Villa Vinga')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role)
       VALUES ($1, $3, $4, 'OWNER'), ($2, $3, $5, 'CONTRIBUTOR')`,
      [`e2e-s178-pm-${tag}`, `e2e-s178-om-${tag}`, householdId, payerId, otherId],
    );
    await client.query(
      `INSERT INTO "BudgetCategory" (id, "householdId", name, type) VALUES ($1, $2, 'Dinner out', 'EXPENSE')`,
      [`e2e-s178-cat-${tag}`, householdId],
    );
    // A personal category, so the sheet starts as a personal expense.
    await client.query(
      `INSERT INTO "PersonalBudgetCategory" (id, "userId", name, type) VALUES ($1, $2, 'Coffee', 'EXPENSE')`,
      [`e2e-s178-pcat-${tag}`, payerId],
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(payerEmail);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/dashboard/personal-budget");
    const main = page.getByRole("main");
    // One action next to the tabs.
    await expect(main.getByRole("button", { name: "Add shared expense" })).toHaveCount(0);
    await main.getByRole("button", { name: "Add transaction" }).click();
    const dialog = page.getByRole("dialog", { name: "Add transaction" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Coffee" })).toBeAttached();
    await expect(dialog.getByRole("radio", { name: "Dinner out" })).toHaveCount(0);

    await dialog.getByLabel("Amount", { exact: true }).fill("400");
    await dialog.getByLabel("Split with household").check();
    // The household's categories replace the personal ones, and the split
    // reads "Paid by you" with the other member's even share.
    await expect(dialog.getByRole("radio", { name: "Coffee" })).toHaveCount(0);
    await expect(dialog.getByText("Paid by you, shared with Other Olle.")).toBeVisible();
    await expect(dialog.getByText(/Other Olle's share 200[\s  ,.]?00/)).toBeVisible();
    await dialog.getByText("Dinner out", { exact: true }).click();
    await dialog.getByLabel("Description").fill(description);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toBeHidden();

    // It's a household transaction: listed on the household budget.
    await page.goto("/dashboard/budget?tab=transactions");
    await expect(main.getByText(description).filter({ visible: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // ...and the other member owes their half.
    const otherContext = await browser.newContext({ baseURL });
    try {
      await dismissCookieNotice(otherContext, baseURL!);
      const other = await otherContext.newPage();
      await other.goto("/login");
      await other.getByLabel("Email").fill(otherEmail);
      await other.getByLabel("Password", { exact: true }).fill(password);
      await other.getByRole("button", { name: "Log in" }).click();
      await expect(other).toHaveURL(/\/dashboard$/);
      await expect(
        other.getByRole("main").getByText("You owe other members").locator(".."),
      ).toContainText(/200[\s  ,.]?00/);
    } finally {
      await otherContext.close();
    }
  } finally {
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[payerId, otherId]]);
    await client.end();
  }
});
