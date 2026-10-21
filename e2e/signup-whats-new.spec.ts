import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { CURRENT_VERSION } from "@/lib/release-notes";
import { E2E_PASSWORD, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-74: a brand-new account starts caught up on "What's new", so its first
// dashboard has no unread update dot.

test.use({ storageState: { cookies: [], origins: [] } });

test("signing up marks the latest release as seen, so the new user sees no update dot", async ({
  page,
  context,
  baseURL,
}) => {
  await dismissCookieNotice(context, baseURL!);
  const email = `signup-seen-${E2E_WORKER}-${Date.now()}@squirrel.test`;

  await page.goto("/signup");
  const t = en.auth.signup;
  await page.getByLabel(t.yourName).fill("Newcomer");
  await page.getByLabel(t.householdName).fill("Newcomers");
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: t.submit }).click();

  // Sign-in is gated on a verified email, so verify the row directly (the
  // confirmation panel differs with whether the e2e environment can send mail).
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await expect
      .poll(async () => (await client.query(`SELECT 1 FROM "User" WHERE email = $1`, [email])).rowCount)
      .toBe(1);
    await client.query(`UPDATE "User" SET "emailVerifiedAt" = now() WHERE email = $1`, [email]);
  } finally {
    await client.end();
  }

  await expect
    .poll(async () => (await context.cookies()).find((c) => c.name === "last_seen_release")?.value)
    .toBe(CURRENT_VERSION);

  await page.goto("/login");
  await page.getByLabel(en.auth.login.email).fill(email);
  await page.getByLabel(en.auth.login.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: en.auth.login.submit }).click();
  await page.waitForURL("**/dashboard**");
  await expect(page.getByText(en.nav.whatsNewUnseen)).toHaveCount(0);
});
