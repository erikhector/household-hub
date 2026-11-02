import { expect, test } from "@playwright/test";
import { dismissCookieNotice } from "./ui";

// UX-157: the dark theme keeps the brand hue. Ground, card and both gradient
// stops carry chroma at the light theme's purple hue (around 300) instead of
// a hueless charcoal.

test.use({ colorScheme: "dark", storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

test("dark ground, cards and gradient share the brand hue", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass(/dark/);

  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      ["--background", "--card", "--gradient-start", "--gradient-end"].map((name) => [
        name,
        style.getPropertyValue(name).trim(),
      ]),
    );
  });
  for (const [name, value] of Object.entries(tokens)) {
    const m = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
    expect(m, `${name} is an oklch colour (got "${value}")`).not.toBeNull();
    const [chroma, hue] = [Number(m![2]), Number(m![3])];
    expect(chroma, `${name} has chroma`).toBeGreaterThanOrEqual(0.03);
    expect(hue, `${name} hue`).toBeGreaterThanOrEqual(290);
    expect(hue, `${name} hue`).toBeLessThanOrEqual(310);
  }

  // The painted page is not neutral grey: its blue channel leads its green.
  const [r, g, b] = await page.evaluate(() => {
    const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)!;
    return m.slice(0, 3).map(Number);
  });
  expect(b).toBeGreaterThan(g);
  expect(r).toBeGreaterThan(g);
});
