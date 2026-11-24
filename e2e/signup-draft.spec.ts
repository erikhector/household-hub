import { expect, test, type Page } from "@playwright/test";
import { withDb } from "./db";
import { en } from "@/lib/i18n/dictionaries/en";
import { SIGNUP_DRAFT_STORAGE_KEY } from "@/lib/cookie-inventory";
import { E2E_HOUSEHOLD } from "./seed";
import { E2E_PASSWORD, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, setLocaleCookie } from "./ui";

// UX-211: a reload mid-signup (a detour to the inbox or a password manager,
// a call, Android discarding the tab) keeps the name, household name and
// email (DESIGN.md M8). The passwords are never stored, and the draft is
// gone once the account exists.
test.use({ storageState: { cookies: [], origins: [] } });

const stamp = `${E2E_WORKER}-${Date.now().toString(36)}`.toLowerCase();
const email = `ux211-${stamp}@squirrel.test`;
const joinEmail = `ux211-join-${stamp}@squirrel.test`;
const token = `ux211-${stamp}`;

async function cleanup() {
  await withDb(async (c) => {
    // The /signup test creates a household of its own, and deleting the
    // User only cascades its HouseholdMember row, so drop that household
    // first. Scoped to `email` alone: `joinEmail` joins E2E_HOUSEHOLD,
    // which must survive.
    await c.query(
      `DELETE FROM "Household" WHERE id IN (
         SELECT m."householdId" FROM "HouseholdMember" m JOIN "User" u ON u.id = m."userId" WHERE u.email = $1)`,
      [email],
    );
    await c.query(`DELETE FROM "User" WHERE "email" = ANY($1)`, [[email, joinEmail]]);
    await c.query(`DELETE FROM "Invitation" WHERE "token" = $1`, [token]);
  });
}

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await cleanup();
});
test.afterEach(cleanup);

const storedDraft = (page: Page) => page.evaluate((key) => sessionStorage.getItem(key), SIGNUP_DRAFT_STORAGE_KEY);

test("a reload keeps the signup's name, household and email but not the password, until the account exists", async ({
  page,
}) => {
  const t = en.auth.signup;
  const household = `Ux Twoeleven ${stamp}`;
  await page.goto("/signup");
  await expectHydrated(page.getByRole("button", { name: t.submit }));
  await page.getByLabel(t.yourName).fill("Ux Twoeleven");
  await page.getByLabel(t.householdName).fill(household);
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
  expect(await storedDraft(page)).not.toContain(E2E_PASSWORD);

  await page.reload();
  await expectHydrated(page.getByRole("button", { name: t.submit }));
  await expect(page.getByLabel(t.yourName)).toHaveValue("Ux Twoeleven");
  await expect(page.getByLabel(t.householdName)).toHaveValue(household);
  await expect(page.getByLabel(t.email)).toHaveValue(email);
  await expect(page.getByLabel(t.password, { exact: true })).toHaveValue("");
  await expect(page.getByLabel(t.confirmPassword)).toHaveValue("");

  // Finish the signup from the restored form.
  await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: t.submit }).click();
  await expect(page.getByRole("heading", { name: t.accountCreatedTitle })).toBeVisible();

  await page.goto("/signup");
  await expectHydrated(page.getByRole("button", { name: t.submit }));
  expect(await storedDraft(page)).toBeNull();
  await expect(page.getByLabel(t.yourName)).toHaveValue("");
  await expect(page.getByLabel(t.householdName)).toHaveValue("");
  await expect(page.getByLabel(t.email)).toHaveValue("");
});

test("a reload keeps the invite sign-up's name and email but not the password", async ({ page }) => {
  const t = en.auth.join;
  await withDb((c) =>
    c.query(
      `INSERT INTO "Invitation" ("id", "householdId", "token", "expiresAt") VALUES ($1, $2, $3, now() + interval '1 day')`,
      [`inv-${token}`, E2E_HOUSEHOLD.id, token],
    ),
  );
  await page.goto(`/join/${token}`);
  await expectHydrated(page.getByRole("button", { name: t.submit }));
  await page.getByLabel(t.yourName).fill("Invited Twoeleven");
  await page.getByLabel(t.email).fill(joinEmail);
  await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);

  await page.reload();
  await expectHydrated(page.getByRole("button", { name: t.submit }));
  await expect(page.getByLabel(t.yourName)).toHaveValue("Invited Twoeleven");
  await expect(page.getByLabel(t.email)).toHaveValue(joinEmail);
  await expect(page.getByLabel(t.password, { exact: true })).toHaveValue("");

  await page.getByLabel(t.password, { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(t.confirmPassword).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: t.submit }).click();
  await expect(page.getByRole("button", { name: t.resend })).toBeVisible();
  expect(await storedDraft(page)).toBeNull();
});

// The privacy page is prose, not dictionary text, so its labels are spelled
// out here.
for (const [locale, kind, noPassword] of [
  ["en", "Session storage", "never your password"],
  ["sv", "Sessionslagring", "aldrig lösenordet"],
] as const) {
  test(`/privacy lists the signup draft as session storage (${locale})`, async ({ page, context, baseURL }) => {
    await setLocaleCookie(context, baseURL!, locale);
    await page.goto("/privacy#cookies");
    const card = page.locator("#cookies li").filter({ hasText: SIGNUP_DRAFT_STORAGE_KEY });
    await expect(card).toContainText(kind);
    await expect(card).toContainText(noPassword);
  });
}
