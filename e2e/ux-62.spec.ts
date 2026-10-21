import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectRendersCleanly, expectTouchTargets, LOCALES, setLocaleCookie } from "./ui";

// UX-62: an invitee's first contact with Squirrel names who invited them,
// shows the brand and a one-line pitch, and a dead link offers the front
// door instead of "Back to log in". The page is public, so the inviter is
// shown as a display name and nothing else.
test.use({ storageState: { cookies: [], origins: [] } });

const stamp = `${E2E_WORKER}-${Date.now().toString(36)}`;
const namedToken = `ux62-named-${stamp}`;
const legacyToken = `ux62-legacy-${stamp}`;

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function cleanup() {
  await withDb((c) => c.query(`DELETE FROM "Invitation" WHERE "token" = ANY($1)`, [[namedToken, legacyToken]]));
}

test.beforeAll(async () => {
  await cleanup();
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO "Invitation" ("id", "householdId", "token", "expiresAt", "invitedById") VALUES ($1, $2, $3, now() + interval '1 day', $4)`,
      [`inv-${namedToken}`, E2E_HOUSEHOLD.id, namedToken, E2E_USER.id],
    );
    // A link made before the inviter was recorded.
    await c.query(
      `INSERT INTO "Invitation" ("id", "householdId", "token", "expiresAt") VALUES ($1, $2, $3, now() + interval '1 day')`,
      [`inv-${legacyToken}`, E2E_HOUSEHOLD.id, legacyToken],
    );
  });
});
test.afterAll(cleanup);

const COPY = {
  en: {
    invited: (inviter: string) => `${inviter} invited you to ${E2E_HOUSEHOLD.name} on Squirrel`,
    legacy: `You're invited to ${E2E_HOUSEHOLD.name} on Squirrel`,
    pitch: "Squirrel keeps your household's shopping, meals, tasks and budget in one place.",
    invalid: "Invalid invite",
    goTo: "Go to Squirrel",
    logIn: "Log in",
    back: "Back to log in",
  },
  sv: {
    invited: (inviter: string) => `${inviter} har bjudit in dig till ${E2E_HOUSEHOLD.name} på Squirrel`,
    legacy: `Du är inbjuden till ${E2E_HOUSEHOLD.name} på Squirrel`,
    pitch: "Squirrel samlar hushållets inköp, måltider, sysslor och budget på ett ställe.",
    invalid: "Ogiltig inbjudan",
    goTo: "Gå till Squirrel",
    logIn: "Logga in",
    back: "Tillbaka till inloggning",
  },
} as const;

for (const locale of LOCALES) {
  test.describe(`join page (${locale})`, () => {
    const t = COPY[locale];

    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
      await dismissCookieNotice(context, baseURL!);
    });

    test("names the inviter, shows the brand and the pitch, and shares signup's fields", async ({ page }, testInfo) => {
      await expectRendersCleanly(page, { pattern: "/join/[token]", path: `/join/${namedToken}` });
      await expect(page.getByRole("heading", { level: 1, name: t.invited(E2E_USER.displayName) })).toBeVisible();
      await expect(page.getByText(t.pitch)).toBeVisible();
      await expect(page.getByRole("link", { name: "Squirrel", exact: true }).first()).toBeVisible();
      // Signup's field styling: the name and email fields carry a leading icon.
      for (const field of ["displayName", "email"]) {
        await expect(page.locator(`#${field}`)).toHaveClass(/pl-8/);
      }
      // Only the display name is public: no email of the inviter anywhere.
      await expect(page.locator("body")).not.toContainText(E2E_USER.email);
      if (testInfo.project.name !== "desktop") await expectTouchTargets(page);
    });

    test("a link without a recorded inviter still reads warmly", async ({ page }) => {
      await page.goto(`/join/${legacyToken}`);
      await expect(page.getByRole("heading", { level: 1, name: t.legacy })).toBeVisible();
      await expect(page.getByText(t.pitch)).toBeVisible();
    });

    test("a dead link offers the front door and log in, not 'back to log in'", async ({ page }, testInfo) => {
      await page.goto("/join/ux62-no-such-token");
      await expect(page.getByRole("heading", { level: 1, name: t.invalid })).toBeVisible();
      await expect(page.getByRole("link", { name: t.goTo })).toHaveAttribute("href", "/");
      await expect(page.getByRole("link", { name: t.logIn })).toHaveAttribute("href", "/login");
      await expect(page.getByRole("link", { name: t.back })).toHaveCount(0);
      if (testInfo.project.name !== "desktop") await expectTouchTargets(page);
    });
  });
}
