import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-157: the dark theme keeps the brand hue. Ground, cards, sidebar and both
// gradient stops are tinted purple (hue around 300, as in light) instead of a
// hueless charcoal.

test.use({ colorScheme: "dark", storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("dark ground, cards and gradient share the brand hue", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);

  // Computed custom properties come back in whatever colour space the
  // browser prefers (lab here), so paint each token on a canvas and read the
  // sRGB pixel back.
  const pixels = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const ctx = document.createElement("canvas").getContext("2d")!;
    return Object.fromEntries(
      ["--background", "--card", "--popover", "--sidebar", "--gradient-start", "--gradient-end"].map((name) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = style.getPropertyValue(name).trim();
        ctx.fillRect(0, 0, 1, 1);
        return [name, [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]];
      }),
    );
  });
  for (const [name, [r, g, b]] of Object.entries(pixels)) {
    // Purple, not neutral grey: blue leads, red beats green, with a visible gap.
    expect(b - g, `${name} is tinted (rgb ${r} ${g} ${b})`).toBeGreaterThanOrEqual(8);
    expect(r - g, `${name} leans purple (rgb ${r} ${g} ${b})`).toBeGreaterThanOrEqual(3);
  }
});
