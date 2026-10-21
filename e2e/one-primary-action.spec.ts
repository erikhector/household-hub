import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

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
