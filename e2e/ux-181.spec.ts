import { expect, test } from "@playwright/test";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow, LOCALES } from "./ui";

// UX-181: at 320 px the empty planner's one primary button wrapped its label
// onto two lines, leaving the "+" floating beside it and the button taller than
// the "Fill empty days" button under it. Both languages are checked, Swedish
// being the longer.
// A far-future week nobody plans in, so it is empty for every run.
const EMPTY_WEEK = "2032-03-02";

for (const locale of LOCALES) {
  test.describe(`empty planner first-dinner button at 320 px (${locale})`, () => {
    test.use({ storageState: locale === "sv" ? STORAGE_STATE_SV : STORAGE_STATE });

    test("keeps its label on one line, as tall as Fill empty days", async ({ page, context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
      await page.setViewportSize({ width: 320, height: 640 });
      const t = (locale === "sv" ? sv : en).mealPlanning;
      await page.goto(`/dashboard/meal-planning?week=${EMPTY_WEEK}`);
      const first = page.getByRole("button", { name: t.addFirstDinner });
      const fill = page.getByRole("button", { name: t.fillEmptyDays, exact: true }).last();
      await expectHydrated(first);
      await expect(fill).toBeVisible();
      // The primary is a 48 px pill and the outline button 44 px by design, so
      // "one line" is read off the text itself: every line box of the label
      // starts at the same top.
      const lineTops = await first.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return [...new Set([...range.getClientRects()].filter((r) => r.width > 24).map((r) => Math.round(r.top)))];
      });
      expect(lineTops, "label lines").toHaveLength(1);
      const [firstBox, fillBox] = await Promise.all([first.boundingBox(), fill.boundingBox()]);
      expect(firstBox!.height).toBeLessThanOrEqual(fillBox!.height + 4);
      await expectNoHorizontalOverflow(page);
    });
  });
}
