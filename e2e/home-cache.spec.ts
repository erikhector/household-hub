import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { unique, uniqueId, withDb } from "./db";
import { clickRowAction, dismissCookieNotice, expectHydrated, expectRouterPatched, waitForDialogHistory } from "./ui";

// PERF-32a: Home's household data can be cached across requests (behind
// HOME_CACHE, off by default), so every edit made elsewhere in the app has to
// clear it. These make an edit on a feature page, or on Home itself, and check
// Home shows it at once: no stale task title, item name or ticked task.
//
// Everything is seeded before Home's first render and every later change
// goes through the UI, so the specs mean the same with the cache on: a write
// straight to Postgres would bypass the Server Actions that clear it. Each
// test gets its own account and household (like home.spec.ts), since the
// Today block lists only the first few tasks and other specs fill the
// seeded household as they run.

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

const PASSWORD = "e2e-password-123";

type Ids = { user: string; household: string; email: string };

async function seedHousehold(seed: (ids: Ids & { member: string }) => Promise<void>): Promise<Ids> {
  const ids = {
    user: uniqueId("e2e-hc-user"),
    household: uniqueId("e2e-hc-household"),
    member: uniqueId("e2e-hc-member"),
    email: `${uniqueId("e2e-hc")}@squirrel.test`,
  };
  await withDb(async (client) => {
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
       VALUES ($1, $2, $3, 'Cache', now(), 'en')`,
      [ids.user, ids.email, await bcrypt.hash(PASSWORD, 10)],
    );
    await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Cache household')`, [ids.household]);
    await client.query(
      `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [ids.member, ids.household, ids.user],
    );
  });
  await seed(ids);
  return ids;
}

async function cleanUp(ids: Ids) {
  await withDb(async (client) => {
    // Household first: its members, tasks and items cascade.
    await client.query(`DELETE FROM "Household" WHERE id = $1`, [ids.household]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [ids.user]);
  });
}

async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** The next Server Action response, for a write that must land before a reload. */
function nextServerAction(page: Page) {
  return page.waitForResponse(
    (response) => response.request().method() === "POST" && "next-action" in response.request().headers(),
    { timeout: 15_000 },
  );
}

test("a task renamed on Tasks and ticked on Home shows on Home at once", async ({ page }) => {
  const title = unique("Descale the kettle");
  const renamed = unique("Descale the coffee maker");
  const ids = await seedHousehold(async ({ household }) => {
    await withDb((client) =>
      client.query(`INSERT INTO "HouseholdTask" (id, "householdId", title) VALUES ($1, $2, $3)`, [
        uniqueId("e2e-hc-task"),
        household,
        title,
      ]),
    );
  });
  try {
    await logIn(page, ids.email);
    const main = page.getByRole("main");
    await expect(main.getByText(title, { exact: true })).toBeVisible();

    // Rename it where tasks are edited.
    await page.goto("/dashboard/tasks");
    const titleButton = main.getByRole("button", { name: title, exact: true });
    await expectHydrated(titleButton);
    await expectRouterPatched(page);
    await titleButton.click();
    const dialog = page.getByRole("dialog", { name: `Edit "${title}"` });
    await dialog.getByRole("textbox", { name: "Task title" }).fill(renamed);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await waitForDialogHistory(page);
    await expect(main.getByRole("button", { name: renamed, exact: true })).toBeVisible();

    // Home has the new title, not the one it showed before.
    await page.goto("/dashboard");
    await expect(main.getByText(renamed, { exact: true })).toBeVisible();
    await expect(main.getByText(title, { exact: true })).toHaveCount(0);

    // Ticked on Home itself, it's gone from Home after a reload.
    const box = main.getByRole("checkbox", { name: `Mark ${renamed} as done` });
    await expectHydrated(box);
    const sent = nextServerAction(page);
    await box.click();
    await sent;
    await page.reload();
    await expect(main.getByText(renamed, { exact: true })).toHaveCount(0);
  } finally {
    await cleanUp(ids);
  }
});

test("an item renamed on its page shows under Use soon on Home at once", async ({ page }) => {
  const name = unique("Yoghurt");
  const renamed = unique("Greek yoghurt");
  const itemId = uniqueId("e2e-hc-item");
  const ids = await seedHousehold(async ({ household }) => {
    await withDb((client) =>
      client.query(
        `INSERT INTO "InventoryItem" (id, "householdId", name, category, quantity, unit, "expiresAt", "updatedAt")
         VALUES ($1, $2, $3, 'Dairy', 1, 'pcs', now() + interval '1 day', now())`,
        [itemId, household, name],
      ),
    );
  });
  try {
    await logIn(page, ids.email);
    const main = page.getByRole("main");
    const chip = main.getByRole("link", { name: new RegExp(`^${name}\\s*· tomorrow`) });
    await expect(chip).toBeVisible();

    await page.goto(`/dashboard/inventory/items/${itemId}`);
    // The Edit button on a wide screen, the ⋯ menu on a phone (clickRowAction).
    const isWide = (page.viewportSize()?.width ?? 1280) >= 640;
    await expectHydrated(page.getByRole("button", { name: isWide ? "Edit item" : "More actions", exact: true }));
    await expectRouterPatched(page);
    await clickRowAction(page, { button: "Edit item", menu: "More actions", item: "Edit" });
    const dialog = page.getByRole("dialog", { name: "Edit inventory item" });
    await dialog.getByRole("textbox", { name: "Name" }).fill(renamed);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await waitForDialogHistory(page);
    await expect(page.getByRole("heading", { name: renamed, level: 1 })).toBeVisible();

    await page.goto("/dashboard");
    await expect(main.getByRole("link", { name: new RegExp(`^${renamed}\\s*· tomorrow`) })).toBeVisible();
    await expect(chip).toHaveCount(0);
  } finally {
    await cleanUp(ids);
  }
});
