import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, expectHydrated } from "./ui";

// UX-182: a dropped request on the invite email shows an error toast and
// keeps what the user typed, instead of throwing to the error boundary.
// Phone-only: that is where requests drop.
test("a dropped invite-email request toasts and keeps the typed address", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  const t = en.household.invite;
  await page.goto("/dashboard/household");
  const open = page.getByRole("button", { name: t.button });
  await expectHydrated(open);
  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(t.linkAriaLabel)).toBeVisible();

  // Only after the link exists: creating it is a Server Action POST too.
  await page.route("**/dashboard/household", (route) =>
    route.request().method() === "POST" ? route.abort("connectionreset") : route.continue(),
  );

  const email = dialog.getByLabel(t.emailPlaceholder);
  await email.fill("friend@example.com");
  await dialog.getByRole("button", { name: t.send, exact: true }).click();

  await expect(page.getByRole("listitem").filter({ hasText: t.sendFailed })).toBeVisible();
  await expect(email).toHaveValue("friend@example.com");
  await expect(dialog).toBeVisible();
  // The error boundary (src/app/error.tsx) would have replaced the page.
  await expect(page.getByText(/something went wrong|något gick fel/i)).toHaveCount(0);
});
