import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectHydrated, expectRouterPatched } from "./ui";

// UX-205: a dropped request on the notes board (Add note, Pin, Delete) toasts
// and keeps the board and the typed note on screen, instead of throwing to the
// dashboard error boundary. Delete goes through the shared ConfirmDialog,
// which stays open so the user can retry.
const unique = (label: string) =>
  `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("a dropped notes request toasts and keeps the board and the typed note", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const t = en.household.notes;
  const existing = unique("Bins go out Tuesday");
  const draft = unique("Plumber Thursday");

  await page.goto("/dashboard/household?tab=notes");
  const textbox = page.getByRole("textbox", { name: t.bodyLabel });
  await expectHydrated(textbox);
  await expectRouterPatched(page);

  // A note to pin and delete, added while online.
  await textbox.fill(existing);
  await page.getByRole("button", { name: t.add }).click();
  const row = page.getByRole("listitem").filter({ hasText: existing });
  await expect(row).toBeVisible();
  await expect(textbox).toHaveValue("");
  // Let the "Note added" toast go so it can't be mistaken for anything below.
  await expect(page.getByRole("listitem").filter({ hasText: t.addedToast })).toHaveCount(0, { timeout: 15_000 });

  await textbox.fill(draft);
  await context.setOffline(true);

  const heading = page.getByRole("heading", { name: t.title, exact: true });
  const failed = page.getByRole("listitem").filter({ hasText: t.saveFailed });
  const boundary = page.getByText(/something went wrong|något gick fel|you're offline/i);
  async function expectBoardKept() {
    await expect(failed.first()).toBeVisible();
    await expect(heading).toBeVisible();
    await expect(textbox).toHaveValue(draft);
    await expect(boundary).toHaveCount(0);
    // Wait the toast out so the next step's toast is its own.
    await expect(failed).toHaveCount(0, { timeout: 15_000 });
  }

  // Add note.
  await page.getByRole("button", { name: t.add }).click();
  await expectBoardKept();

  // Pin.
  await row.getByRole("button", { name: /^Pin note by/ }).click();
  await expectBoardKept();
  await expect(row.getByText(t.pinned)).toHaveCount(0);

  // Delete: the confirm dialog stays open for a retry.
  await row.getByRole("button", { name: /^Delete note by/ }).click();
  const dialog = page.getByRole("dialog", { name: t.confirmDelete.title });
  await dialog.getByRole("button", { name: t.confirmDelete.confirm, exact: true }).click();
  await expect(failed.first()).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(boundary).toHaveCount(0);
  await dialog.getByRole("button", { name: t.confirmDelete.cancel }).click();
  await expect(dialog).toBeHidden();
  await expect(heading).toBeVisible();
  await expect(textbox).toHaveValue(draft);
  await expect(row).toBeVisible();

  await context.setOffline(false);
});
