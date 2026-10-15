import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-12 (DESIGN.md M2, thumb zone): the sheet footer must sit exactly at the
// sheet's bottom edge while the sheet scrolls — not 16px above it. The
// footer is sticky, but `position: sticky` constrains its MARGIN box, and
// the `-mb-[max(1rem,env(safe-area-inset-bottom))]` full-bleed pull is part
// of that box: with a plain `bottom-0` the border box stuck exactly that
// margin above the sheet bottom (measured 16.0px on a 16px safe area, more
// under a home indicator), leaving a visible strip under Save. The stick
// offset negates the same margin (dialog.tsx), so this measures the footer
// border bottom against the sheet bottom at two scroll positions. (UX-34:
// the scroller is the sheet's body, under the grabber, so that's what
// scrolls here; its bottom is the sheet's.)
test.skip(({ isMobile }) => !isMobile, "sticky-footer rule: the sheet footer pins while scrolled");

test("the add-item footer sits flush with the sheet bottom while scrolled", async ({
  page,
  context,
  baseURL,
}) => {
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/dashboard/inventory");
  await page.getByRole("button", { name: "Add item" }).click();

  const dialog = page.getByRole("dialog", { name: "Add inventory item" });
  await expect(dialog).toBeVisible();

  const body = dialog.locator('[data-slot="dialog-body"]');
  const overflow = await body.evaluate((root) => ({
    scrollHeight: root.scrollHeight,
    clientHeight: root.clientHeight,
  }));
  // The form must actually overflow, or nothing scrolls and the assertion
  // below is vacuous.
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
  const maxScroll = overflow.scrollHeight - overflow.clientHeight;

  // Mid-scroll (the footer is stuck, not at its natural end position) and
  // fully scrolled (natural position): the border box must meet the sheet
  // bottom in both. 1px of slack for sub-pixel rounding.
  for (const top of [Math.floor(maxScroll / 2), maxScroll]) {
    await body.evaluate((root, scrollTop) => {
      root.scrollTop = scrollTop;
    }, top);
    const pinned = await body.evaluate((root) => {
      const footer = root.querySelector<HTMLElement>('[data-slot="dialog-footer"]')!;
      return {
        sheetBottom: root.getBoundingClientRect().bottom,
        footerBottom: footer.getBoundingClientRect().bottom,
      };
    });
    expect(Math.abs(pinned.footerBottom - pinned.sheetBottom), `footer flush at scrollTop ${top}`).toBeLessThanOrEqual(
      1,
    );
  }
});
