import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// iOS 26 tints the status-bar strip from a fixed element at the top edge
// and blurs it when there is none (dashboard/layout.tsx). Chromium can't
// show the blur, so this pins down what iOS samples: a fixed box at the
// very top, in the phone header's colour, that stays put while main
// scrolls. Phone only by its file name: from `sm` there's no header.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("a fixed strip in the header's colour sits on the top edge", async ({ page }) => {
  await page.goto("/dashboard/inventory");
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();

  const strip = page.locator('[data-slot="status-bar-backdrop"]');
  const style = await strip.evaluate((el) => {
    const s = getComputedStyle(el);
    return { position: s.position, top: s.top, background: s.backgroundColor };
  });
  expect(style.position).toBe("fixed");
  expect(style.top).toBe("0px");
  const headerBackground = await page
    .locator("header")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(style.background).toBe(headerBackground);

  // WebKit finds the edge's element by hit testing, the way
  // elementFromPoint does: the first version of the strip had
  // pointer-events: none, the hit test went straight through it, and iOS
  // kept blurring the top edge.
  const atTopEdge = await page.evaluate(
    () => document.elementFromPoint(innerWidth / 2, 0)?.getAttribute("data-slot") ?? null,
  );
  expect(atTopEdge).toBe("status-bar-backdrop");
  // The header is a second, full-height sticky signal at the same edge.
  expect(await page.locator("header").first().evaluate((el) => getComputedStyle(el).position)).toBe("sticky");

  const box = (await strip.boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.height).toBeGreaterThanOrEqual(1);
  expect(box.width).toBe(page.viewportSize()!.width);

  // Fixed, so scrolling main doesn't move it.
  await page.getByRole("main").evaluate((el) => el.scrollBy(0, 400));
  expect((await strip.boundingBox())!.y).toBe(0);
});
