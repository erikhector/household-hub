import { expect, test } from "@playwright/test";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { dismissCookieNotice, setLocaleCookie } from "./ui";

// UX-178: under 40 rem each footer link is a 44 px-wide box. "Villkor" is
// narrower than that, and with its text left-aligned the box padded on the
// right, so the gap to "Integritet" read several times the others.
// Phone-only: from 40 rem the links are plain inline text.
test.use({ storageState: { cookies: [], origins: [] } });

test("the legal footer's links are evenly spaced in Swedish", async ({ page, context, baseURL }) => {
  await setLocaleCookie(context, baseURL!, "sv");
  await dismissCookieNotice(context, baseURL!);
  await page.goto("/login");
  const nav = page.getByRole("navigation").filter({ has: page.getByRole("link", { name: sv.legal.termsNavLabel }) });
  await expect(nav).toBeVisible();

  // Measure the text itself (a Range over the link's text), not the box.
  const rects = await nav.evaluate((el) =>
    [...el.querySelectorAll("a")].map((a) => {
      const range = document.createRange();
      range.selectNodeContents(a);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, height: r.height };
    }),
  );
  expect(rects.length).toBeGreaterThanOrEqual(3);

  // Links that wrap onto another row have no horizontal neighbour; only
  // compare pairs sharing a row.
  const gaps: number[] = [];
  for (let i = 1; i < rects.length; i++) {
    if (Math.abs(rects[i].top - rects[i - 1].top) < rects[i].height / 2) {
      gaps.push(rects[i].left - rects[i - 1].right);
    }
  }
  expect(gaps.length).toBeGreaterThanOrEqual(2);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  expect(spread).toBeLessThanOrEqual(1);
});
