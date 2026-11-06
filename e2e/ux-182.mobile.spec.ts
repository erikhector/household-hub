import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-182: a dropped request on the invite email shows an error toast and
// keeps what the user typed, instead of throwing to the error boundary.
// Phone-only: that is where requests drop.
test("a dropped invite-email request toasts and keeps the typed address", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const t = en.household.invite;
  await page.goto("/dashboard/household");
  const open = page.getByRole("button", { name: t.button });
  await expectHydrated(open);
  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(t.linkAriaLabel)).toBeVisible();

  // Only after the link exists: creating it is a Server Action POST too.
  await page.route("**/dashboard/household", (route) =>
    route.request().method() === "POST" ? route.abort("connectionreset") : route.continue(),
  );

  const email = dialog.getByLabel(t.emailPlaceholder);
  await email.fill("friend@example.com");
  await dialog.getByRole("button", { name: t.send, exact: true }).click();

  await expect(page.getByRole("listitem").filter({ hasText: t.sendFailed })).toBeVisible();
  await expect(email).toHaveValue("friend@example.com");
  await expect(dialog).toBeVisible();
  // The error boundary (src/app/error.tsx) would have replaced the page.
  await expect(page.getByText(/something went wrong|något gick fel/i)).toHaveCount(0);
});

// The owner's Transfer and Remove catches. Own household and accounts so the
// owner/contributor roles are known (same setup as ux-145.spec.ts).
test.describe("a dropped member-action request", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("toasts, closes the transfer dialog and keeps the page", async ({ page, context, baseURL }, testInfo) => {
    await dismissCookieNotice(context, baseURL!);
    const tag = `${Date.now().toString(36)}-${testInfo.project.name}`;
    const ownerId = `e2e-m182-owner-${tag}`;
    const otherId = `e2e-m182-other-${tag}`;
    const householdId = `e2e-m182-household-${tag}`;
    const email = `e2e-m182-${tag}@squirrel.test`;
    const password = "e2e-password-123";
    const name = "Casey Contributor";
    const t = en.household;

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const hash = await bcrypt.hash(password, 10);
      await client.query(
        `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
         VALUES ($1, $2, $3, 'Owner Olive', now(), 'en'), ($4, $5, $3, $6, now(), 'en')`,
        [ownerId, email, hash, otherId, `e2e-m182-other-${tag}@squirrel.test`, name],
      );
      await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Drop household')`, [householdId]);
      await client.query(
        `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role)
         VALUES ($1, $2, $3, 'OWNER'), ($4, $2, $5, 'CONTRIBUTOR')`,
        [`e2e-m182-m1-${tag}`, householdId, ownerId, `e2e-m182-m2-${tag}`, otherId],
      );

      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.goto("/dashboard/household");

      const menu = page.getByRole("button", { name: `Member actions for ${name}` });
      await expectHydrated(menu);
      await page.route("**/dashboard/household", (route) =>
        route.request().method() === "POST" ? route.abort("connectionreset") : route.continue(),
      );
      const boundary = page.getByText(/something went wrong|något gick fel/i);
      const toast = (text: string) => page.getByRole("listitem").filter({ hasText: text });

      // Transfer: toast, and the dialog closes.
      await menu.click();
      await page.getByRole("menuitem", { name: t.memberActions.transfer }).click();
      const transfer = page.getByRole("dialog", { name: `Transfer ownership to ${name}?` });
      await transfer.getByRole("button", { name: t.transfer.confirmButton }).click();
      await expect(toast(t.transfer.failed)).toBeVisible();
      await expect(transfer).toBeHidden();
      await expect(boundary).toHaveCount(0);

      // Remove: toast, member still listed.
      await menu.click();
      await page.getByRole("menuitem", { name: t.memberActions.remove }).click();
      await page
        .getByRole("dialog", { name: `Remove ${name}?` })
        .getByRole("button", { name: t.confirmRemoveMember.confirm, exact: true })
        .click();
      await expect(toast(t.memberActions.removeFailed)).toBeVisible();
      await expect(boundary).toHaveCount(0);
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    } finally {
      await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
      await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[ownerId, otherId]]);
      await client.end();
    }
  });
});
