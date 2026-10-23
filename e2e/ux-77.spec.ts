import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_MEMBER_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-77: the seeded user has exactly one household, which the server refuses
// to delete. The danger zone says so inline instead of offering a red button
// that opens a refusal, and what it points at depends on who else is in the
// household, because deleteAccountAction removes a household only for its
// sole member.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("only household with other members: points at the member list, not Delete account", async ({ page }) => {
  // The seeded household has two members.
  await page.goto("/dashboard/household");

  await expect(page.getByRole("heading", { name: "Danger zone" })).toBeVisible();
  await expect(page.getByText(/it has other members/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete household" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Go to Delete account" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "Go to the members" }).click();
  await expect(page).toHaveURL(/#household-members$/);
});

test.describe("sole member", () => {
  // Park the second seeded member in a throwaway household of their own, so
  // the signed-in owner is alone in theirs. The row keeps its id, so rows
  // that point at it are untouched, and it goes back afterwards.
  const parkedId = `ux77-parked-${E2E_WORKER}`;

  test.beforeEach(async () => {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      await db.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'UX77 Parked')`, [parkedId]);
      await db.query(`UPDATE "HouseholdMember" SET "householdId" = $1 WHERE id = $2`, [parkedId, E2E_MEMBER_SV]);
    } finally {
      await db.end();
    }
  });

  test.afterEach(async () => {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      await db.query(`UPDATE "HouseholdMember" SET "householdId" = $1 WHERE id = $2`, [E2E_HOUSEHOLD.id, E2E_MEMBER_SV]);
      await db.query(`DELETE FROM "Household" WHERE id = $1`, [parkedId]);
    } finally {
      await db.end();
    }
  });

  test("danger zone explains the rule and the link lands on an open Delete account", async ({ page }) => {
    await page.goto("/dashboard/household");

    await expect(page.getByRole("heading", { name: "Danger zone" })).toBeVisible();
    await expect(page.getByText(/This is your only household, so it can't be deleted on its own/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete household" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: "Go to Delete account" }).click();
    await expect(page).toHaveURL(/\/dashboard\/profile/);
    // The profile's Danger zone is a disclosure; the link opens it.
    await expect(page.getByRole("button", { name: "Delete account" })).toBeVisible();
  });
});
