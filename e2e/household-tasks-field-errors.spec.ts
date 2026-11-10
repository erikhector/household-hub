import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { E2E_HOUSEHOLD, E2E_USER, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import {
  createHouseholdMenuTrigger,
  dismissCookieNotice,
  expectHydrated,
  gotoRevealed,
  setLocaleCookie,
} from "./ui";

// UX-183b: the task dialog, the create-household dialog, the household
// rename card and the invite sign-up form word a missing field under it, in
// the page's language (role="alert"), instead of the browser's own bubble.
// Focus moves to the first empty field, it gets aria-invalid, the message
// clears as the field is edited, and what was typed elsewhere stays.
// (The no-household page's form is the same hook; that page is only
// reachable by a user with zero households, which the seed has none of.)
const DICTS = { en, sv } as const;

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

for (const locale of ["en", "sv"] as const) {
  const t = DICTS[locale];

  test.describe(`household and task field errors (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });

    test("an empty task title is flagged under the field, keeping the notes", async ({ page }) => {
      await gotoRevealed(page, "/dashboard/tasks");
      const open = page.getByRole("button", { name: t.tasks.addTask }).first();
      await expectHydrated(open);
      await open.click();
      const dialog = page.getByRole("dialog", { name: t.tasks.addTaskDialogTitle });
      const title = dialog.getByRole("textbox", { name: t.tasks.addTaskAriaLabel });
      const notes = dialog.getByRole("textbox", { name: t.tasks.notesLabel });
      await notes.fill("kept notes");

      await dialog.getByRole("button", { name: t.tasks.add, exact: true }).click();
      const alert = dialog.getByRole("alert").filter({ hasText: t.tasks.titleRequired });
      await expect(alert).toBeVisible();
      await expect(title).toHaveAttribute("aria-invalid", "true");
      await expect(title).toBeFocused();
      await expect(notes).toHaveValue("kept notes");

      await title.fill("Water the plants");
      await expect(alert).toHaveCount(0);
    });

    test("an empty name in Create household is flagged under the field", async ({ page, isMobile }) => {
      await page.goto("/dashboard");
      const trigger = createHouseholdMenuTrigger(page, isMobile, t.nav.more);
      await expectHydrated(trigger);
      await trigger.click();
      await page.getByRole("menuitem", { name: t.household.switcher.createMenuItem }).click();
      const dialog = page.getByRole("dialog", { name: t.household.switcher.createNew });
      const name = dialog.getByLabel(t.household.switcher.nameLabel);

      await dialog.getByRole("button", { name: t.household.switcher.create, exact: true }).click();
      const alert = dialog.getByRole("alert").filter({ hasText: t.household.switcher.nameRequired });
      await expect(alert).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();

      await name.fill("A household");
      await expect(alert).toHaveCount(0);
    });

    test("a cleared household name is flagged under the field on the rename card", async ({ page }) => {
      await page.goto("/dashboard/household?tab=settings");
      const name = page.getByRole("textbox", { name: t.household.rename.label, exact: true });
      await expectHydrated(name);
      await name.fill("");
      await page.getByRole("button", { name: t.household.rename.save }).click();

      const alert = page.getByRole("alert").filter({ hasText: t.household.rename.nameRequired });
      await expect(alert).toBeVisible();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();

      await name.fill(E2E_HOUSEHOLD.name);
      await expect(alert).toHaveCount(0);
    });
  });

  test.describe(`invite sign-up field errors (${locale})`, () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    const token = `fe-join-${E2E_WORKER}-${locale}-${Date.now().toString(36)}`;

    async function withDb(fn: (c: Client) => Promise<unknown>) {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await fn(client);
      } finally {
        await client.end();
      }
    }
    test.beforeAll(() =>
      withDb((c) =>
        c.query(
          `INSERT INTO "Invitation" ("id", "householdId", "token", "expiresAt", "invitedById") VALUES ($1, $2, $3, now() + interval '1 day', $4)`,
          [`inv-${token}`, E2E_HOUSEHOLD.id, token, E2E_USER.id],
        ),
      ),
    );
    test.afterAll(() => withDb((c) => c.query(`DELETE FROM "Invitation" WHERE "token" = $1`, [token])));
    test.beforeEach(async ({ context, baseURL }) => {
      await setLocaleCookie(context, baseURL!, locale);
    });

    test("empty fields are flagged under each field, keeping what was typed", async ({ page }) => {
      await page.goto(`/join/${token}`);
      const name = page.getByLabel(t.auth.join.yourName);
      await expectHydrated(name);
      const form = page.locator("form").filter({ has: name });
      await form.getByLabel(t.auth.join.email).fill("kept@squirrel.test");

      await form.getByRole("button", { name: t.auth.join.submit }).click();
      await expect(form.getByRole("alert").filter({ hasText: t.auth.join.nameRequired })).toBeVisible();
      await expect(form.getByRole("alert").filter({ hasText: t.auth.join.passwordRequired })).toBeVisible();
      await expect(form.getByRole("alert").filter({ hasText: t.auth.join.confirmPasswordRequired })).toBeVisible();
      await expect(form.getByRole("alert").filter({ hasText: t.auth.join.emailRequired })).toHaveCount(0);
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toBeFocused();
      await expect(form.getByLabel(t.auth.join.email)).toHaveValue("kept@squirrel.test");

      await name.fill("Someone");
      await expect(form.getByRole("alert").filter({ hasText: t.auth.join.nameRequired })).toHaveCount(0);
      await expect(form.getByRole("alert").filter({ hasText: t.auth.join.passwordRequired })).toBeVisible();
    });
  });
}
