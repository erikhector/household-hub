import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_USER } from "./seed";
import { E2E_ITEM, E2E_WORKER } from "./seed-data";
import { dismissCookieNotice } from "./ui";

// UX-31: screen-reader and small-screen semantics.

test("an unread notification says 'Unread' in text, not only with a dot", async ({ page }) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Notification" WHERE "householdId" = $1`, [E2E_HOUSEHOLD.id]);
    await client.query(
      `INSERT INTO "Notification" (id, "householdId", kind, "inventoryItemId") VALUES ($1, $2, 'EXPIRING_SOON', $3)`,
      [`ux31-unread-${E2E_WORKER}`, E2E_HOUSEHOLD.id, E2E_ITEM.id],
    );
  } finally {
    await client.end();
  }

  await page.goto("/dashboard/notifications");
  // The word is part of the link's accessible name, so a screen reader reads it.
  const link = page.getByRole("main").getByRole("link", { name: /Unread/ });
  try {
    await expect(link).toHaveCount(1);
    // sr-only: in the accessibility tree, not visible as text.
    const box = await link.getByText("Unread", { exact: true }).boundingBox();
    expect(box === null || (box.width <= 1 && box.height <= 1)).toBe(true);
  } finally {
    // An unread row adds a count badge to the nav ("1 More"), which would
    // break specs that look the nav up by its label.
    const cleanup = new Client({ connectionString: process.env.DATABASE_URL });
    await cleanup.connect();
    await cleanup.query(`DELETE FROM "Notification" WHERE id = 'ux31-unread'`);
    await cleanup.end();
  }
});

test("long list names clamp to two lines on phones and one on desktop", async ({ page, context, baseURL }, testInfo) => {
  // On a phone the cookie notice covers the floating primary action (UX-40).
  await dismissCookieNotice(context, baseURL!);
  const name = `Clamp ${Date.now().toString(36)} ${"very long name ".repeat(12)}`.trim();
  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page).toHaveURL(/\/dashboard\/shopping-list\/[^/]+$/);

  await page.goto("/dashboard/shopping-list");
  // The server shortens very long names, so match on the unique prefix.
  const prefix = name.split(" ").slice(0, 2).join(" ");
  const label = page.getByRole("main").getByText(new RegExp(`^${prefix}`)).first();
  await expect(label).toBeVisible();
  const clamp = await label.evaluate((el) => getComputedStyle(el).webkitLineClamp);
  expect(clamp).toBe(testInfo.project.name === "mobile" ? "2" : "1");
});

test("new list name does not autofill", async ({ page, context, baseURL }) => {
  // On a phone the cookie notice covers the floating primary action (UX-40).
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/shopping-list");
  await page.getByRole("button", { name: "New list" }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveAttribute("autocomplete", "off");
});

test("delete household: confirm field is exact-match, has a Cancel and no autocorrect", async ({ page, context, baseURL }) => {
  // Deleting is blocked for someone's only household, so give the user a
  // second one for the duration of the test.
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  // Ids carry the worker: workers share one database, so a fixed id collides
  // when two of them (or two repeats) run this test at once.
  const secondId = `ux31-second-${E2E_WORKER}`;
  await db.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'UX31 Second')`, [secondId]);
  await db.query(
    `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
    [`${secondId}-member`, secondId, E2E_USER.id],
  );
  try {
    await dismissCookieNotice(context, baseURL!);
    await page.goto("/dashboard/household");
    await page.getByRole("button", { name: "Delete household" }).click();
    const field = page.getByRole("textbox", { name: /Type .* to confirm/ });
    await expect(field).toHaveAttribute("autocapitalize", "off");
    await expect(field).toHaveAttribute("autocorrect", "off");
    const confirm = page.getByRole("dialog").getByRole("button", { name: "Delete household" });
    await expect(confirm).toBeDisabled();
    // Surrounding whitespace (a keyboard's trailing space) still matches.
    await field.fill(`  ${E2E_HOUSEHOLD.name} `);
    await expect(confirm).toBeEnabled();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await db.query(`DELETE FROM "Household" WHERE id = $1`, [secondId]);
    await db.end();
  }
});

test("invite email is a form, so Enter submits it", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/household");
  await page.getByRole("button", { name: "Invite member" }).click();
  const email = page.getByRole("textbox", { name: "Their email address" });
  await expect(email).toBeVisible();
  expect(await email.evaluate((el) => el.closest("form") !== null)).toBe(true);
  await email.fill("someone@squirrel.test");
  await email.press("Enter");
  // Success or a delivery error: either way Enter did something (a toast).
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
});

test("password form carries a hidden username for password managers", async ({ page }) => {
  await page.goto("/dashboard/profile");
  // The profile page streams in behind loading.tsx. CI once counted a second
  // username input a moment after the count passed (MAINT-36; not reproduced
  // locally), so wait until the form is really shown before counting, which
  // keeps the count and the value check on the same settled page.
  await expect(page.locator("#currentPasswordForPassword")).toBeVisible();
  const username = page.locator('input[autocomplete="username"]');
  await expect(username).toHaveCount(1);
  await expect(username).toHaveValue(E2E_USER.email);
});
