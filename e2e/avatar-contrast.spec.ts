import { expect, test } from "@playwright/test";
import { dismissCookieNotice, gotoRevealed } from "./ui";

// UX-161 (WCAG 1.4.3): avatar initials were white on the mid-tone chart
// colors (2.05:1 on chart-2). Each tint now carries its own ink; this
// measures the painted pair in the browser, for the avatar on the profile
// page and for all five tints in both themes, since the seeded user only
// shows one of them.
const INK_CLASSES = [
  "bg-chart-1 text-(--avatar-ink-1)",
  "bg-chart-2 text-(--avatar-ink-2)",
  "bg-chart-3 text-(--avatar-ink-3)",
  "bg-chart-4 text-(--avatar-ink-4)",
  "bg-chart-5 text-(--avatar-ink-5)",
];

test("avatar initials hold 4.5:1 on every tint in both themes", async ({ page, context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
  await gotoRevealed(page, "/dashboard/profile");

  const ratios = await page.evaluate((classes) => {
    // Computed colors come back as oklch()/lab(); a canvas pixel is sRGB.
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgb = (css: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    };
    const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const measure = (el: Element) => {
      const s = getComputedStyle(el);
      const [hi, lo] = [lum(rgb(s.color)), lum(rgb(s.backgroundColor))].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    };
    const out: Record<string, number> = {};
    const real = document.querySelector("main div.rounded-full.size-16");
    if (real) out.profile = measure(real);
    for (const theme of ["light", "dark"]) {
      document.documentElement.classList.toggle("dark", theme === "dark");
      classes.forEach((cls, i) => {
        const el = document.createElement("div");
        el.className = cls;
        el.textContent = "AB";
        document.body.append(el);
        out[`${theme} chart-${i + 1}`] = measure(el);
        el.remove();
      });
    }
    document.documentElement.classList.remove("dark");
    return out;
  }, INK_CLASSES);

  expect(ratios.profile, "the profile avatar was not found").toBeDefined();
  for (const [name, ratio] of Object.entries(ratios)) {
    expect(ratio, `${name} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});
