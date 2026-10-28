// Guards globals.css against colour changes that make text or controls
// unreadable. Every pair below is one the UI actually paints (see the
// comments in globals.css and components/ui/*), checked in both themes
// against WCAG 2: 4.5:1 for text, 3:1 for field outlines and the focus
// ring. Tweaking a token so a pair drops under its floor fails `npm test`
// with the pair, theme and ratio in the message.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS = readFileSync(path.resolve(__dirname, "globals.css"), "utf8");

// The custom properties declared directly in a top-level block, e.g. ":root"
// or ".dark". Only oklch() and hex values are expected for colours here.
function block(selector: string): Record<string, string> {
  const start = CSS.search(new RegExp(`^${selector.replace(".", "\\.")} \\{`, "m"));
  if (start < 0) throw new Error(`no ${selector} block in globals.css`);
  const body = CSS.slice(CSS.indexOf("{", start) + 1, CSS.indexOf("\n}", start));
  const vars: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[name] = value.trim();
  return vars;
}

type Rgb = [number, number, number]; // linear sRGB, 0..1

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

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const toGamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

/** Parses "oklch(L C h)", "oklch(L C h / A%)" or "#rrggbb" into colour + alpha. */
function parse(value: string): { rgb: Rgb; alpha: number } {
  const ok = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)%)?\)$/);
  if (ok) {
    return { rgb: oklchToLinear(+ok[1], +ok[2], +ok[3]), alpha: ok[4] === undefined ? 1 : +ok[4] / 100 };
  }
  const hex = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) return { rgb: [hex[1], hex[2], hex[3]].map((h) => toLinear(parseInt(h, 16) / 255)) as Rgb, alpha: 1 };
  throw new Error(`unparsed colour ${value}`);
}

// Alpha-composites fg over bg in gamma space, as the browser paints it.
// Also stands in for color-mix()'s small tints: close enough at 10–20%
// that the thresholds below keep a margin for the difference.
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((c, i) => toLinear(toGamma(c) * alpha + toGamma(bg[i]) * (1 - alpha))) as Rgb;
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = {
  light: block(":root"),
  // .dark only overrides; anything it doesn't set falls back to :root.
  dark: { ...block(":root"), ...block(".dark") },
};

describe.each(Object.entries(THEMES))("globals.css %s theme", (theme, vars) => {
  const raw = (name: string) => {
    if (!vars[name]) throw new Error(`--${name} is not set`);
    return parse(vars[name]);
  };
  // A token painted onto `ground`: translucent tokens (dark --border,
  // --input) composite over it.
  const color = (name: string, ground: Rgb): Rgb => {
    const { rgb, alpha } = raw(name);
    return alpha < 1 ? over(rgb, alpha, ground) : rgb;
  };
  const solid = (name: string) => raw(name).rgb;
  const tintPercent = Number.parseFloat(vars["status-tint"]) / 100;

  const surfaces = ["background", "card", "popover", "muted"] as const;
  const pairs: [label: string, fg: Rgb, bg: Rgb, min: number][] = [];

  for (const s of surfaces) {
    pairs.push([`foreground on ${s}`, solid("foreground"), solid(s), 4.5]);
    pairs.push([`muted-foreground on ${s}`, solid("muted-foreground"), solid(s), 4.5]);
  }
  for (const fill of ["primary", "secondary", "accent", "sidebar-primary", "sidebar-accent"]) {
    pairs.push([`${fill}-foreground on ${fill}`, solid(`${fill}-foreground`), solid(fill), 4.5]);
  }
  pairs.push(["primary (links) on background", solid("primary"), solid("background"), 4.5]);
  pairs.push(["primary (links) on card", solid("primary"), solid("card"), 4.5]);

  // Status colours are text on a --status-tint of themselves (Badge, the
  // destructive Button, rich toasts) as well as on plain surfaces.
  for (const status of ["destructive", "warning", "attention", "success"]) {
    for (const s of ["background", "card", "popover"] as const) {
      pairs.push([`${status} on ${s}`, solid(status), solid(s), 4.5]);
      pairs.push([
        `${status} on its ${vars["status-tint"]} tint over ${s}`,
        solid(status),
        over(solid(status), tintPercent, solid(s)),
        4.5,
      ]);
    }
  }

  for (const s of ["background", "card", "popover"] as const) {
    pairs.push([`input (field outline) on ${s}`, color("input", solid(s)), solid(s), 3]);
    pairs.push([`ring (focus) on ${s}`, solid("ring"), solid(s), 3]);
  }

  // The landing page's fridge door: dark ink on every paper note, the red
  // scribble on the receipt, and the text on the deep purple "night" band.
  // These tokens hold the same value in both themes.
  for (const note of ["note-paper", "note-yellow", "note-pink", "note-mint", "note-green"]) {
    pairs.push([`note-ink on ${note}`, solid("note-ink"), solid(note), 4.5]);
  }
  pairs.push(["note-red on note-paper", solid("note-red"), solid("note-paper"), 4.5]);
  for (const fg of ["night-foreground", "night-muted", "night-accent"]) {
    pairs.push([`${fg} on night`, solid(fg), solid("night"), 4.5]);
  }

  // UX-25 (light theme polish) fixed its usages by pointing them at pairs
  // already guarded above, so no new token — and no new pair — was needed:
  // disabled solid buttons use muted-foreground on muted (was white at 50%
  // opacity over a 50% primary wash, ~1.5:1); the active segmented tab is a
  // card pill (foreground on card) ringed off the muted track (the
  // secondary fill was 1.03:1 against it); the overview stats are warning /
  // primary / foreground on card (chart-1/2 as text were 3.5:1 and 2.9:1).
  // The completed onboarding rows needed nothing: UX-26 already hides them
  // behind the "n of 5 done" line instead of fading them.

  it.each(pairs)("%s", (label, fg, bg, min) => {
    const ratio = contrast(fg, bg);
    expect(ratio, `${theme}: ${label} is ${ratio.toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min);
  });
});
