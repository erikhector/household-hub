import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { E2E_PASSWORD, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-56: the account locale outranks the `locale` cookie once someone is
// signed in, so signing up while the UI shows Swedish must store `sv` or the
// first dashboard after login comes up English.

test.use({ storageState: { cookies: [], origins: [] } });

test("signing up in Swedish gives a Swedish dashboard on first login", async ({
  page,
  context,
  baseURL,
}) => {
  await dismissCookieNotice(context, baseURL!);
  await context.addCookies([{ name: "locale", value: "sv", url: baseURL! }]);
  const email = `signup-sv-${E2E_WORKER}-${Date.now()}@squirrel.test`;

  await page.goto("/signup");
  const t = sv.auth.signup;
  await page.getByLabel(t.yourName).fill("Svensson");
  await page.getByLabel(t.householdName).fill("Svenssons");
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: t.submit }).click();
  // The confirmation panel differs with whether the e2e environment can send
  // mail, so wait for the account row itself rather than for the panel.
  // Sign-in is gated on a verified email, so verify the row directly and
  // check what was stored.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await expect
      .poll(async () => (await client.query(`SELECT 1 FROM "User" WHERE email = $1`, [email])).rowCount)
      .toBe(1);
    const res = await client.query(
      `UPDATE "User" SET "emailVerifiedAt" = now() WHERE email = $1 RETURNING locale`,
      [email],
    );
    expect(res.rows[0]?.locale).toBe("sv");
  } finally {
    await client.end();
  }

  // Drop the cookie so only the account's locale can make this Swedish.
  await context.clearCookies({ name: "locale" });
  await page.goto("/login");
  await page.getByLabel(en.auth.login.email).fill(email);
  await page.getByLabel(en.auth.login.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: en.auth.login.submit }).click();
  await page.waitForURL("**/dashboard**");
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
});
