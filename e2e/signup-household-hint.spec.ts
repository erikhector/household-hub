import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// UX-60: signup assumes a new household, so it must point invitees to their
// link and explain what "Household name" is for.

test.use({ storageState: { cookies: [], origins: [] } });

test("signup points invitees to their link and explains the household name", async ({
  page,
  context,
  baseURL,
}) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/signup");
  const t = en.auth.signup;
  await expect(page.getByText(t.joinHint)).toBeVisible();
  const field = page.getByLabel(t.householdName);
  await expect(field).toHaveAccessibleDescription(t.householdNameHint);
  await field.focus();
  await expect(page.getByText(t.householdNameHint)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
