import { expect, test } from "@playwright/test";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { collectErrors, dismissCookieNotice } from "./ui";

// UX-25 (light theme polish): computed-style regression guards for the
// fixes. The app defaults to dark, so every test forces the light theme
// first (next-themes reads localStorage before it paints). Contrast math
// lives in Node on the computed strings, keeping the in-page queries tiny.

// -- sRGB helpers (relative luminance + contrast, WCAG 2) -----------------
function parse(css: string): { rgb: [number, number, number]; alpha: number } {
  const nums = css.match(/[\d.]+/g)!.map(Number);
  return { rgb: [nums[0] / 255, nums[1] / 255, nums[2] / 255], alpha: nums[3] ?? 1 };
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function over(
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number],
): [number, number, number] {
  return fg.map((c, i) => toLinear(toGamma(c) * alpha + toGamma(bg[i]) * (1 - alpha))) as [
    number,
    number,
    number,
  ];
}

const luminance = (rgb: [number, number, number]) =>
  0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);

function contrast(a: string, aOpacity: number, b: string, base = "#ffffff"): number {
  const fg = parse(a);
  const bg = parse(b);
  const baseRgb = parse(base).rgb;
  const hi = luminance(over(fg.rgb, fg.alpha * aOpacity, over(bg.rgb, bg.alpha, baseRgb)));
  const lo = luminance(over(bg.rgb, bg.alpha, baseRgb));
  const [top, bottom] = hi > lo ? [hi, lo] : [lo, hi];
  return (top + 0.05) / (bottom + 0.05);
}

test.beforeEach(async ({ context, baseURL, page }) => {
  await dismissCookieNotice(context, baseURL!);
  await page.addInitScript(() => {
    localStorage.setItem("theme", "light");
  });
});

test("the light theme is actually on", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("overview stats meet text contrast in the light theme", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/dashboard");
  // Each stat number with the card behind it: heading text (for the failure
  // message) plus the two computed colours. Scoped to the three household
  // cards, whose chart-1/2 fills (3.5:1 and 2.9:1 on card) this fixes —
  // the safe-to-spend card's tinted background doesn't resolve to a plain
  // rgb triple, so it stays out of this sRGB math.
  const headings = ["Low stock items", "Shopping lists", "Total items tracked"];
  const stats = await page.evaluate((wanted) =>
    Array.from(document.querySelectorAll('main [data-slot="card"]'))
      .map((card) => {
        const text = card.textContent ?? "";
        if (!wanted.some((h) => text.includes(h))) return null;
        const stat = card.querySelector("p.font-display");
        if (!stat) return null;
        const style = getComputedStyle(stat);
        return {
          heading: text.slice(0, 40),
          fg: style.color,
          bg: getComputedStyle(card).backgroundColor,
        };
      })
      .filter((s) => s !== null),
  headings);
  expect(stats.length, "stat numbers on the overview").toBe(3);
  for (const s of stats) {
    expect(contrast(s.fg, 1, s.bg), `stat in "${s.heading}…"`).toBeGreaterThanOrEqual(4.5);
  }
  expect(errors).toEqual([]);
});

test("a disabled primary button stays readable", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/dashboard/tasks");
  // The create dialog's submit is disabled until the title has text — a
  // primary button in its disabled state whatever the seed holds.
  await page.getByRole("button", { name: "Add task" }).click();
  const submit = page.getByRole("button", { name: "Add", exact: true });
  await expect(submit).toBeDisabled();
  // White at 50% opacity over a 50% primary wash was ~1.5:1; the fix keeps
  // full opacity on a muted fill, so both the opacity and the pair matter.
  const painted = await submit.evaluate((el) => {
    const style = getComputedStyle(el);
    return { opacity: style.opacity, fg: style.color, bg: style.backgroundColor };
  });
  expect(painted.opacity).toBe("1");
  expect(contrast(painted.fg, Number(painted.opacity), painted.bg)).toBeGreaterThanOrEqual(4.5);
  expect(errors).toEqual([]);
});

test("the active segmented tab is edged off its track", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/dashboard/budget");
  const tablist = page.getByRole("tablist");
  await expect(tablist).toBeVisible();
  // The secondary fill used to be 1.03:1 against the muted track; the fix
  // raises the active tab as a ringed card pill instead.
  const painted = await page.evaluate(() => {
    const list = document.querySelector('[role="tablist"]')!;
    const selected = list.querySelector('[aria-selected="true"]')!;
    const selectedStyle = getComputedStyle(selected);
    return {
      tabBg: selectedStyle.backgroundColor,
      trackBg: getComputedStyle(list.parentElement!).backgroundColor,
      borderAlpha: parseFloat(selectedStyle.borderColor.match(/[\d.]+/g)!.slice(-1)[0]),
      shadow: selectedStyle.boxShadow,
    };
  });
  expect(painted.tabBg).not.toBe(painted.trackBg);
  expect(painted.borderAlpha).toBeGreaterThan(0);
  expect(painted.shadow).not.toBe("none");
  expect(errors).toEqual([]);
});

test("fields use the 1px outline", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/dashboard/inventory");
  const search = page.getByRole("searchbox").first();
  await expect(search).toBeVisible();
  await expect(search).toHaveCSS("border-top-width", "1px");
  expect(errors).toEqual([]);
});

test("phone sticky bars blur over the gradient", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 999) >= 640, "max-sm: sticky styles only apply on phones");
  const errors = collectErrors(page);
  // The inventory search bar and the shopping-list add line: both used to
  // paint an opaque band over the page gradient.
  for (const path of ["/dashboard/inventory", `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`]) {
    await page.goto(path);
    const bars = await page.evaluate(() =>
      Array.from(document.querySelectorAll("main *"))
        .filter((el) => el.querySelector("input") && getComputedStyle(el).position === "sticky")
        .map((el) => {
          const style = getComputedStyle(el);
          return { backdrop: style.backdropFilter, bg: style.backgroundColor };
        }),
    );
    expect(bars.length, `sticky bars on ${path}`).toBeGreaterThanOrEqual(1);
    for (const bar of bars) {
      expect(bar.backdrop, `backdrop on ${path}`).toContain("blur");
      // Translucent: either an rgba with alpha under 1 or a color-mix with
      // a percentage under 100 (Tailwind v4 serialises either way).
      const alpha = bar.bg.startsWith("color-mix")
        ? Number(bar.bg.match(/([\d.]+)%(?=[^%]*$)/)![1]) / 100
        : (parse(bar.bg).alpha ?? 1);
      expect(alpha, `background alpha on ${path}`).toBeLessThan(1);
    }
  }
  expect(errors).toEqual([]);
});
