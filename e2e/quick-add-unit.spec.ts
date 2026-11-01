import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-1: the empty inventory's quick-add row wrapped the Unit combobox in a
// column too narrow for its own clear (×) and chevron buttons, so "pcs" was
// clipped to one character. The seeded household already owns items, and the
// quick-add row only shows while a household has none, so each test gets its
// own empty household and account (straight to Postgres, like
// item-page.spec.ts) and logs in through the real form. Pinned to 390px, the
// width the bug was reported at (the mobile project is 412px).
// A fresh context (no shared session), or /login would bounce to the dashboard.
test.use({ viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [] } });

const PASSWORD = "e2e-password-123";

for (const [locale, unitLabel, toggleLabel] of [
  ["en", "Unit", "Or type several in a row"],
  ["sv", "Enhet", "Eller skriv in flera i rad"],
] as const) {
  test(`quick-add's unit field shows its whole value (${locale})`, async ({ page, context, baseURL }, testInfo) => {
    await dismissCookieNotice(context, baseURL!);
    const tag = `${Date.now().toString(36)}-${testInfo.project.name}-${locale}`;
    const userId = `e2e-qa-user-${tag}`;
    const householdId = `e2e-qa-household-${tag}`;
    const email = `e2e-qa-${tag}@squirrel.test`;

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
         VALUES ($1, $2, $3, 'Quick Add', now(), $4)`,
        [userId, email, await bcrypt.hash(PASSWORD, 10), locale],
      );
      await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Quick add household')`, [householdId]);
      await client.query(
        `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
        [`e2e-qa-member-${tag}`, householdId, userId],
      );

      // The login form's language comes from the cookie, not the account.
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      await page.goto("/dashboard/inventory");
      // UX-50: the row waits behind a text button under the empty state's one
      // primary, instead of sitting open beside it.
      await page.getByRole("button", { name: toggleLabel }).click();
      const unit = page.getByLabel(unitLabel, { exact: true });
      await expect(unit).toBeVisible();

      // The value is "pcs" in both languages, and all of it is on screen:
      // the input's content fits its box (scrollWidth would exceed
      // clientWidth if the text were clipped) and the box is wider than a
      // single character.
      await expect(unit).toHaveValue("pcs");
      const { scrollWidth, clientWidth } = await unit.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(scrollWidth, "unit text is clipped").toBeLessThanOrEqual(clientWidth);
      expect(clientWidth, "unit input can't show three characters").toBeGreaterThanOrEqual(30);
      await expectNoHorizontalOverflow(page);
    } finally {
      // Household first: its members cascade with it.
      await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
      await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
      await client.end();
    }
  });
}

// UX-132: Enter in an early field used to add the row at once (half an item).
// Now it walks name -> quantity -> unit -> category and only the last field
// adds. English only: the behaviour doesn't depend on the language.
test("quick-add's Enter moves to the next field and only the last one adds", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await dismissCookieNotice(context, baseURL!);
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}-enter`;
  const userId = `e2e-qe-user-${tag}`;
  const householdId = `e2e-qe-household-${tag}`;
  const email = `e2e-qe-${tag}@squirrel.test`;
  const itemName = `Enter walk ${tag}`;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Quick Enter', now(), 'en')`,
      [userId, email, await bcrypt.hash(PASSWORD, 10)],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Quick enter household')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [`e2e-qe-member-${tag}`, householdId, userId],
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/dashboard/inventory");
    await page.getByRole("button", { name: "Or type several in a row" }).click();

    const name = page.getByLabel("Name", { exact: true });
    const quantity = page.getByLabel("Quantity", { exact: true });
    const unit = page.getByLabel("Unit", { exact: true });
    // The desktop Category filter shares this accessible name (UX-155), so
    // keep to the quick-add text input.
    const category = page.getByLabel("Category", { exact: true }).and(page.locator("input"));
    const count = async () =>
      Number(
        (await client.query(`SELECT count(*) FROM "InventoryItem" WHERE "householdId" = $1`, [householdId]))
          .rows[0].count,
      );

    await name.fill(itemName);
    await name.press("Enter");
    await expect(quantity).toBeFocused();
    await quantity.press("Enter");
    await expect(unit).toBeFocused();
    await unit.press("Enter");
    await expect(category).toBeFocused();
    expect(await count(), "an early Enter must not add the item").toBe(0);

    await category.fill("Pantry");
    await category.press("Enter");
    // The bar only shows while the inventory is empty, so it goes away once
    // the item exists.
    await expect.poll(count).toBe(1);
    await expect(name).toBeHidden();
  } finally {
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
    await client.end();
  }
});
