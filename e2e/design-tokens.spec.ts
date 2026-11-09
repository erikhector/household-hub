import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { dismissCookieNotice, gotoRevealed } from "./ui";

// UX-176: DESIGN.md's type and shadow tokens are defined in globals.css's
// @theme, so a class like `text-page-title` or `shadow-primary` really paints.
// An undefined utility is silently dropped, which would leave the title at the
// browser default and the button flat, and no build step would notice.
test("the page title and primary button paint their DESIGN.md tokens", async ({
  page,
  context,
  baseURL,
  isMobile,
}) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard/household?tab=settings");

  // page-title is 24px; on phones the large title (30px) takes over.
  const heading = page.getByRole("heading", { level: 1, name: en.household.title });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveCSS("font-size", isMobile ? "30px" : "24px");

  // shadow-primary: the default button carries a coloured, not flat, shadow.
  const invite = page.getByRole("button", { name: en.household.invite.button });
  await expect(invite).toBeVisible();
  await expect(invite).not.toHaveCSS("box-shadow", "none");
});
