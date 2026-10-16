import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice } from "./ui";

// UX-72: the overview greets by the clock in the user's own time zone, with
// the first name only. The server runs in UTC, so 12:30 in Stockholm (10:30
// UTC in summer) used to say "Good morning". The seeded user's name is
// renamed by other specs, so this spec gets its own account ("Åsa
// Lindström") and household, straight to Postgres and logged in through the
// real form (like overview.spec.ts). A fresh context, or /login would
// bounce to the dashboard.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

async function withUser(
  testInfo: { project: { name: string } },
  run: (login: (page: import("@playwright/test").Page) => Promise<void>) => Promise<void>,
) {
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${testInfo.project.name}`;
  const userId = `e2e-gr-user-${tag}`;
  const householdId = `e2e-gr-household-${tag}`;
  const email = `e2e-gr-${tag}@squirrel.test`;
  const password = "e2e-password-123";
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Åsa Lindström', now(), 'en')`,
      [userId, email, await bcrypt.hash(password, 10)],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Greeting household')`, [householdId]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [`e2e-gr-member-${tag}`, householdId, userId],
    );
    await run(async (page) => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    });
  } finally {
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
    await client.end();
  }
}

const heading = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });

test.describe("in Stockholm", () => {
  test.use({ timezoneId: "Europe/Stockholm" });

  test("at 12:30 the heading says good afternoon, by first name", async ({ page }, testInfo) => {
    await withUser(testInfo, async (login) => {
      // 10:30 UTC is 12:30 CEST; a UTC-hour greeting would say "morning".
      await page.clock.setFixedTime(new Date("2026-07-01T10:30:00Z"));
      await login(page);
      await expect(heading(page, "Good afternoon, Åsa")).toBeVisible();
    });
  });

  test("20:30 UTC is already evening", async ({ page }, testInfo) => {
    await withUser(testInfo, async (login) => {
      await page.clock.setFixedTime(new Date("2026-07-01T20:30:00Z"));
      await login(page);
      await expect(heading(page, "Good evening, Åsa")).toBeVisible();
    });
  });
});

test.describe("in Los Angeles", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("the same 10:30 UTC instant is still morning", async ({ page }, testInfo) => {
    await withUser(testInfo, async (login) => {
      await page.clock.setFixedTime(new Date("2026-07-01T10:30:00Z"));
      await login(page);
      await expect(heading(page, "Good morning, Åsa")).toBeVisible();
    });
  });
});
