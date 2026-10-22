import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-145: an owner's row for another member shows the full name and one
// "Member actions" menu, instead of a Transfer and a Remove icon side by
// side. Both actions are labelled in the menu and Remove still asks first.
// Own household and accounts (straight to Postgres, logged in through the
// real form) so the owner/contributor roles are known.

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("an owner reaches Transfer and Remove from one Member actions menu", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 640 });
  const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
  const ownerId = `e2e-ma-owner-${tag}`;
  const otherId = `e2e-ma-other-${tag}`;
  const householdId = `e2e-ma-household-${tag}`;
  const email = `e2e-ma-${tag}@squirrel.test`;
  const password = "e2e-password-123";
  const longName = "Maximilian Alexander Featherstonehaugh";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Owner Olive', now(), 'en'), ($4, $5, $3, $6, now(), 'en')`,
      [ownerId, email, hash, otherId, `e2e-ma-other-${tag}@squirrel.test`, longName],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Actions household')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role)
       VALUES ($1, $2, $3, 'OWNER'), ($4, $2, $5, 'CONTRIBUTOR')`,
      [`e2e-ma-m1-${tag}`, householdId, ownerId, `e2e-ma-m2-${tag}`, otherId],
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/dashboard/household");

    // No icon of its own for either action any more.
    await expect(page.getByRole("button", { name: `Remove ${longName}` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Make ${longName} the owner` })).toHaveCount(0);

    // The full name, on at most two lines, with nothing pushed off screen.
    const name = page.getByText(longName, { exact: true });
    await expect(name).toBeVisible();
    const box = await name.boundingBox();
    const lineHeight = await name.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect(box!.height).toBeLessThanOrEqual(lineHeight * 2 + 1);
    expect(await name.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await expectNoHorizontalOverflow(page);

    const menu = page.getByRole("button", { name: `Member actions for ${longName}` });
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "Make owner" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Remove from household" }).click();

    // Remove asks first; cancelling keeps the member.
    const dialog = page.getByRole("dialog", { name: `Remove ${longName}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(name).toBeVisible();

    // Transfer also asks first.
    await menu.click();
    await page.getByRole("menuitem", { name: "Make owner" }).click();
    const transfer = page.getByRole("dialog", { name: `Transfer ownership to ${longName}?` });
    await expect(transfer).toBeVisible();
    await transfer.getByRole("button", { name: "Cancel" }).click();
    await expect(transfer).toBeHidden();

    // Confirming Remove removes them.
    await menu.click();
    await page.getByRole("menuitem", { name: "Remove from household" }).click();
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(name).toHaveCount(0);
  } finally {
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[ownerId, otherId]]);
    await client.end();
  }
});
