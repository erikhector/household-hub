import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { en } from "@/lib/i18n/dictionaries/en";
import { E2E_HOUSEHOLD } from "./seed";
import { unique, uniqueId, withDb } from "./db";
import { dismissCookieNotice, expectHydrated } from "./ui";

// GAP-89: "Going shopping" in a list's ⋯ menu pushes the other members and
// confirms with a toast. The push itself isn't observable here (no push
// service in e2e, and the seeded users have no subscriptions); the unit test
// covers who it goes to. Each test makes its own list, so the per-user-and-
// list rate limit never carries over between projects or runs.

const t = en.shoppingList;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("Going shopping tells the household and confirms with a toast", async ({ page }) => {
  const listId = uniqueId("e2e-going-shopping");
  const listName = unique("Trip");
  await withDb(async (client) => {
    await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
      listId,
      E2E_HOUSEHOLD.id,
      listName,
    ]);
  });

  try {
    await page.goto(`/dashboard/shopping-list/${listId}`);
    await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();
    const more = page.getByRole("button", { name: t.moreActions });
    await expectHydrated(more);
    await more.click();
    await page.getByRole("menuitem", { name: t.goingShopping.menuItem }).click();
    await expect(page.getByText(t.goingShopping.toast)).toBeVisible();
  } finally {
    await withDb((client) =>
      client.query(`DELETE FROM "ShoppingList" WHERE id = $1 AND "householdId" = $2`, [listId, E2E_HOUSEHOLD.id]),
    );
  }
});

test.describe("a one-member household", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("has no Going shopping item, since there's no one to tell", async ({ page }) => {
    const ids = {
      user: uniqueId("e2e-gs-user"),
      household: uniqueId("e2e-gs-household"),
      list: uniqueId("e2e-gs-list"),
    };
    const email = `${ids.user}@squirrel.test`;
    const password = "e2e-password-123";
    const listName = unique("Solo trip");

    await withDb(async (client) => {
      try {
        await client.query(
          `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
           VALUES ($1, $2, $3, 'Solo', now(), 'en')`,
          [ids.user, email, await bcrypt.hash(password, 10)],
        );
        await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Solo house')`, [ids.household]);
        await client.query(
          `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
          [`${ids.household}-member`, ids.household, ids.user],
        );
        await client.query(`INSERT INTO "ShoppingList" (id, "householdId", name) VALUES ($1, $2, $3)`, [
          ids.list,
          ids.household,
          listName,
        ]);

        await page.goto("/login");
        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Log in" }).click();
        await expect(page).toHaveURL(/\/dashboard$/);

        await page.goto(`/dashboard/shopping-list/${ids.list}`);
        await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();
        const more = page.getByRole("button", { name: t.moreActions });
        await expectHydrated(more);
        await more.click();
        // The menu is open (its trip actions are there), just without this one.
        await expect(page.getByRole("menuitem", { name: t.shareLink.button })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: t.goingShopping.menuItem })).toHaveCount(0);
      } finally {
        await client.query(`DELETE FROM "Household" WHERE id = $1`, [ids.household]);
        await client.query(`DELETE FROM "User" WHERE id = $1`, [ids.user]);
      }
    });
  });
});
