import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { dismissCookieNotice, expectHydrated, expectOnePrimaryAction } from "./ui";

// UX-24: one primary (solid) action per view. DESIGN.md's hierarchy rule
// reads the solid `default` Button as "the" call to action, so the checks
// below read the variant through its background token: `bg-primary` is
// primary, `bg-secondary` is the quiet one.
// Timestamp plus a random tail: the specs share one seeded household and
// never clean up, so a name must not collide with (or be a prefix of) a row
// left by an earlier project, retry or run.
const unique = (label: string) =>
  `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PRIMARY = /(^|\s)bg-primary(\s|$)/;
const SECONDARY = /(^|\s)bg-secondary(\s|$)/;

test("profile save buttons are quiet until their form has changes", async ({ page }) => {
  await page.goto("/dashboard/profile");

  const saveName = page.getByRole("button", { name: "Save changes" });
  const updateEmail = page.getByRole("button", { name: "Update email" });
  const updatePassword = page.getByRole("button", { name: "Update password" });
  for (const button of [saveName, updateEmail, updatePassword]) {
    await expect(button).toHaveClass(SECONDARY);
  }

  await page.getByLabel("Display name").fill(unique("Name"));
  await expect(saveName).toHaveClass(PRIMARY);
  // Only the card being edited lights up.
  await expect(updateEmail).toHaveClass(SECONDARY);

  await page.getByLabel("New email").fill("someone@example.com");
  await expect(updateEmail).toHaveClass(PRIMARY);
  await page.getByLabel("New email").fill("");
  await expect(updateEmail).toHaveClass(SECONDARY);
});

test("household page: Invite member is the one primary action", async ({ page }) => {
  await page.goto("/dashboard/household");
  await expect(page.getByRole("button", { name: "Invite member" })).toHaveClass(PRIMARY);
  await expect(page.getByRole("button", { name: "Add note" })).toHaveClass(SECONDARY);
  const turnOn = page.getByRole("button", { name: "Turn on calendar feed" });
  // Only the owner sees it; the seeded user may be either.
  if (await turnOn.count()) await expect(turnOn).toHaveClass(SECONDARY);
});

test("task create and edit dialogs share one footer, and the title can be renamed", async ({ page, context, baseURL }) => {
  // On the phone the cookie notice floats over the bottom of the list and
  // intercepts the click on a freshly added row's Edit button.
  await dismissCookieNotice(context, baseURL!);
  const title = unique("Sweep the porch");
  const renamed = unique("Sweep the deck");
  await page.goto("/dashboard/tasks");

  await page.getByRole("button", { name: "Add task" }).click();
  const create = page.getByRole("dialog");
  await expect(create.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(create.getByRole("button", { name: "Add", exact: true })).toHaveClass(PRIMARY);
  await create.getByRole("textbox", { name: "Task title" }).fill(title);
  await create.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  // UX-106: the title opens the edit sheet at every width.
  await page.getByRole("main").getByRole("button", { name: title, exact: true }).click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(edit.getByRole("button", { name: "Save", exact: true })).toHaveClass(PRIMARY);
  const field = edit.getByRole("textbox", { name: "Task title" });
  await expect(field).toHaveValue(title);
  await field.fill(renamed);
  await edit.getByRole("button", { name: "Save", exact: true }).click();

  // The dialog closes once the Server Action has settled; reloading before
  // that aborts the in-flight save.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  // Reload: the rename must have reached the database. Assert through the
  // row's accessible buttons, not getByText: right after a reload React's
  // streamed HTML still holds a hidden (`<div hidden>`) copy of the list
  // next to the live one until the Suspense swap finishes, and getByText
  // matches both (a strict-mode violation). Role queries skip hidden
  // elements, so they only ever see the rendered row.
  await page.reload();
  await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});

// UX-153: the tasks "Everyone / Mine" switch is a segmented track, so "Add
// task" stays the only solid button.
test("tasks: the Everyone / Mine filter doesn't compete with Add task", async ({ page }) => {
  await page.goto("/dashboard/tasks");
  const main = page.getByRole("main");
  const mine = main.getByRole("tab", { name: "Mine", exact: true });
  await expect(mine).toBeVisible();
  await expectOnePrimaryAction(page);
  await expect(main.getByRole("button", { name: "Add task" })).toHaveClass(PRIMARY);
  await expectHydrated(mine);
  await mine.click();
  await expect(mine).toHaveAttribute("aria-selected", "true");
  await expectOnePrimaryAction(page);
});

// A fresh household has no categories and no income, the state where the
// starter-set card and the setup card show.
test.describe("budget pages with no categories", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("each has one solid button", async ({ page, context, baseURL }, testInfo) => {
    await dismissCookieNotice(context, baseURL!);
    const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${testInfo.project.name}`;
    const email = `e2e-op-${tag}@squirrel.test`;
    const userId = `e2e-op-user-${tag}`;
    const householdId = `e2e-op-hh-${tag}`;
    const password = "e2e-password-123";
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO "User" (id, email, "passwordHash", "displayName", "emailVerifiedAt", locale)
         VALUES ($1, $2, $3, 'Solo Member', now(), 'en')`,
        [userId, email, await bcrypt.hash(password, 10)],
      );
      await client.query(`INSERT INTO "Household" (id, name) VALUES ($1, 'Quiet House')`, [householdId]);
      await client.query(
        `INSERT INTO "HouseholdMember" (id, "householdId", "userId", role) VALUES ($1, $2, $3, 'OWNER')`,
        [`e2e-op-m-${tag}`, householdId, userId],
      );
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);

      for (const route of ["/dashboard/budget", "/dashboard/personal-budget"]) {
        await page.goto(route);
        await expect(page.getByRole("main").getByText(/set up your budget|Let's set up/i).first()).toBeVisible();
        await expectOnePrimaryAction(page);
      }
    } finally {
      await client.query(`DELETE FROM "Household" WHERE id = $1`, [householdId]);
      await client.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
      await client.end();
    }
  });
});
