import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { E2E_PASSWORD, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-73: a new household starts with a currency label derived from the
// signup language (sv -> SEK) or the browser region (en-GB -> GBP) instead of
// bare numbers, and the budget's first-run card shows it with one tap to
// change. Each test signs up a fresh account, so it has its own household
// with no categories (the onboarding state) whatever else the worker ran.

test.use({ storageState: { cookies: [], origins: [] } });

async function signUp(
  page: import("@playwright/test").Page,
  t: typeof en.auth.signup,
  email: string,
  householdName: string,
) {
  await page.goto("/signup");
  await page.getByLabel(t.yourName).fill("Currency Tester");
  await page.getByLabel(t.householdName).fill(householdName);
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: t.submit }).click();
}

// Sign-in is gated on a verified email; verify the row directly (the mail
// may not be sendable here) and return the household's stored currency.
async function verifyAndReadCurrency(email: string): Promise<string | null> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await expect
      .poll(async () => (await client.query(`SELECT 1 FROM "User" WHERE email = $1`, [email])).rowCount)
      .toBe(1);
    await client.query(`UPDATE "User" SET "emailVerifiedAt" = now() WHERE email = $1`, [email]);
    const res = await client.query(
      `SELECT h."currencyCode" FROM "Household" h
         JOIN "HouseholdMember" m ON m."householdId" = h.id
         JOIN "User" u ON u.id = m."userId"
        WHERE u.email = $1`,
      [email],
    );
    return res.rows[0]?.currencyCode ?? null;
  } finally {
    await client.end();
  }
}

async function cleanUp(email: string) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM "Household" WHERE id IN (
         SELECT m."householdId" FROM "HouseholdMember" m JOIN "User" u ON u.id = m."userId" WHERE u.email = $1)`,
      [email],
    );
    await client.query(`DELETE FROM "User" WHERE email = $1`, [email]);
  } finally {
    await client.end();
  }
}

test("a Swedish signup starts in SEK and the budget card changes it in one tap", async ({
  page,
  context,
  baseURL,
}) => {
  await dismissCookieNotice(context, baseURL!);
  await context.addCookies([{ name: "locale", value: "sv", url: baseURL! }]);
  const email = `signup-cur-sv-${E2E_WORKER}-${Date.now()}@squirrel.test`;
  try {
    await signUp(page, sv.auth.signup, email, "Valutastugan");
    expect(await verifyAndReadCurrency(email)).toBe("SEK");

    await page.goto("/login");
    await page.getByLabel(sv.auth.login.email).fill(email);
    await page.getByLabel(sv.auth.login.password, { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: sv.auth.login.submit }).click();
    await page.waitForURL("**/dashboard**");

    await page.goto("/dashboard/budget");
    const currency = page.getByRole("combobox", { name: sv.budget.onboarding.currencyLabel });
    await expect(currency).toContainText("SEK");
    await expectNoHorizontalOverflow(page);

    await currency.click();
    await page.getByRole("option", { name: /EUR/ }).click();
    await expect(page.getByText(sv.household.currency.savedToast)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("combobox", { name: sv.budget.onboarding.currencyLabel })).toContainText("EUR");
  } finally {
    await cleanUp(email);
  }
});

test.describe("an English signup", () => {
  test.use({ locale: "en-GB" });

  test("starts in the browser region's currency", async ({ page, context, baseURL }) => {
    await dismissCookieNotice(context, baseURL!);
    const email = `signup-cur-en-${E2E_WORKER}-${Date.now()}@squirrel.test`;
    try {
      await signUp(page, en.auth.signup, email, "Currency Cottage");
      expect(await verifyAndReadCurrency(email)).toBe("GBP");

      await page.goto("/login");
      await page.getByLabel(en.auth.login.email).fill(email);
      await page.getByLabel(en.auth.login.password, { exact: true }).fill(E2E_PASSWORD);
      await page.getByRole("button", { name: en.auth.login.submit }).click();
      await page.waitForURL("**/dashboard**");

      await page.goto("/dashboard/budget");
      await expect(page.getByRole("combobox", { name: en.budget.onboarding.currencyLabel })).toContainText("GBP");
    } finally {
      await cleanUp(email);
    }
  });
});
