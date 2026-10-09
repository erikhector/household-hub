import { expect, test } from "@playwright/test";
import { E2E_SHOPPING_LIST } from "./seed-data";
import { collectErrors, dismissCookieNotice } from "./ui";

// UX-25 (light theme polish): computed-style regression guards for the
// fixes. The app defaults to dark, so every test forces the light theme
// first (next-themes reads localStorage before it paints). Contrast math
// lives in Node on the computed strings, keeping the in-page queries tiny.

// -- colour helpers (contrast, WCAG 2) --------------------------------------
// Computed colours arrive as the browser serialises them — rgb()/rgba(),
// oklch() (the app's tokens) or color-mix() (Tailwind opacity modifiers) —
// so the parser handles all three, with the same oklch→linear-sRGB math as
// src/app/globals-contrast.test.ts. color-mix() blends premultiplied in
// linear sRGB rather than the named space: an approximation, with enough
// margin under the 4.5:1 floors here.
type Rgb = [number, number, number];

function oklchToLinear(L: number, C: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

// Split on top-level commas (nested rgb()/oklch() may hold their own).
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function parseAlpha(rest: string | undefined): number {
  if (rest === undefined) return 1;
  const alpha = rest.trim();
  return alpha.endsWith("%") ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
}

function parse(css: string): { rgb: Rgb; alpha: number } {
  const value = css.trim().toLowerCase();
  if (value === "transparent") return { rgb: [0, 0, 0], alpha: 0 };

  const hex = value.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    const nums = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((x) => parseInt(x, 16) / 255);
    return { rgb: [nums[0], nums[1], nums[2]], alpha: 1 };
  }

  const rgb = value.match(/^rgba?\((.+)\)$/);
  if (rgb) {
    const [channels, alpha] = rgb[1].split("/");
    const nums = channels.replace(/,/g, " ").split(/\s+/).filter(Boolean).map(Number);
    return { rgb: [nums[0] / 255, nums[1] / 255, nums[2] / 255], alpha: parseAlpha(alpha) };
  }

  const oklch = value.match(/^oklch\((.+)\)$/);
  if (oklch) {
    const [channels, alpha] = oklch[1].split("/");
    const [l, c, h] = channels.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    const lightness = l.endsWith("%") ? Number(l.slice(0, -1)) / 100 : Number(l);
    // parse() speaks gamma-encoded sRGB throughout (like rgb()/hex), so the
    // linear result is encoded back; luminance() linearises again.
    const [lr, lg, lb] = oklchToLinear(lightness, Number(c), Number(h));
    return { rgb: [toGamma(lr), toGamma(lg), toGamma(lb)], alpha: parseAlpha(alpha) };
  }

  const mix = value.match(/^color-mix\(in\s+[\w-]+\s*,\s*(.+)\)$/);
  if (mix) {
    const [first, second] = splitTopLevel(mix[1]);
    const part = (s: string) => {
      const pct = s.match(/([\d.]+)%\s*$/);
      return { color: s.replace(/[\d.]+%\s*$/, "").trim(), pct: pct ? Number(pct[1]) / 100 : null };
    };
    const a = part(first.trim());
    const b = part((second ?? "").trim());
    // A missing percentage takes the remainder (Tailwind always writes the
    // first one, e.g. `color-mix(in oklab, … 85%, transparent)`). Blended
    // premultiplied in linear light like the unit test's over().
    const pa = a.pct ?? (b.pct === null ? 0.5 : 1 - (b.pct ?? 0));
    const ca = parse(a.color || "transparent");
    const cb = parse(b.color || "transparent");
    const la = ca.rgb.map(toLinear);
    const lb = cb.rgb.map(toLinear);
    const mixed = la.map((c, i) => c * pa * ca.alpha + lb[i] * (1 - pa) * cb.alpha);
    const alpha = pa * ca.alpha + (1 - pa) * cb.alpha;
    const unpremultiply = (c: number) => (alpha === 0 ? 0 : toGamma(c / alpha));
    return { rgb: [unpremultiply(mixed[0]), unpremultiply(mixed[1]), unpremultiply(mixed[2])], alpha };
  }

  throw new Error(`unparsed colour ${css}`);
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
  // message) plus the two computed colours. Matched by exact card title —
  // a substring match also caught cards whose buttons echo the heading
  // ("View shopping lists"). The chart-1/2 fills these wore were 3.5:1 and
  // 2.9:1 on card. The safe-to-spend card's tinted background doesn't
  // resolve to a plain colour triple, so it stays out of this math.
  const headings = ["Low stock items", "Shopping lists", "Total items tracked"];
  const stats = await page.evaluate((wanted) =>
    Array.from(document.querySelectorAll('main [data-slot="card"]'))
      .map((card) => {
        const title = card.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? "";
        if (!wanted.includes(title)) return null;
        const stat = card.querySelector("p.font-display");
        if (!stat) return null;
        const style = getComputedStyle(stat);
        return {
          heading: title,
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
      border: selectedStyle.borderColor,
      shadow: selectedStyle.boxShadow,
    };
  });
  expect(painted.tabBg).not.toBe(painted.trackBg);
  expect(parse(painted.border).alpha, "active tab ring").toBeGreaterThan(0);
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
  // paint an opaque band over the page gradient. Each is found through the
  // field it holds (any other sticky on the page — a table header, a
  // checkbox row — is not this bar), then its nearest sticky ancestor is
  // the painted band.
  const bars = [
    { path: "/dashboard/inventory", field: page.getByRole("searchbox").first() },
    {
      path: `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`,
      field: page.getByRole("combobox", { name: "Add to the list" }),
    },
  ];
  for (const { path, field } of bars) {
    await page.goto(path);
    await expect(field).toBeVisible();
    const painted = await field.evaluate((el) => {
      let node: Element | null = el;
      while (node && getComputedStyle(node).position !== "sticky") node = node.parentElement;
      if (!node) return null;
      const style = getComputedStyle(node);
      return { backdrop: style.backdropFilter, bg: style.backgroundColor };
    });
    expect(painted, `sticky bar on ${path}`).not.toBeNull();
    expect(painted!.backdrop, `backdrop on ${path}`).toContain("blur");
    // Translucent: the 85% background resolves with an alpha under 1
    // however the browser serialises the color-mix.
    expect(parse(painted!.bg).alpha, `background alpha on ${path}`).toBeLessThan(1);
  }
  expect(errors).toEqual([]);
});
