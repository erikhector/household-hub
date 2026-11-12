// UX-176: DESIGN.md names its shadows and type sizes as tokens (`@theme` in
// globals.css). A component that reaches for Tailwind's stock shadow-sm/md/lg
// or a bare text-3xl/4xl stat size forks the system again (popups had drifted
// across md and lg, and the overview and safe-to-spend stats across 3xl and
// 4xl), so this fails on a new one.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const COMPONENTS = __dirname;
const CSS = path.resolve(__dirname, "../app/globals.css");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") ? [full] : [];
  });
}

// Display headings that are not stats: the landing page's fridge-door
// letters (DESIGN.md: hero is landing-only) and the print stylesheet's list
// title, which must not follow the app's theme.
const HEADING_ALLOWLIST = ["landing/fridge-door.tsx", "shopping/printable-list.tsx"];

function offenders(pattern: RegExp, allow: string[] = []): string[] {
  return tsxFiles(COMPONENTS)
    .map((f) => path.relative(COMPONENTS, f))
    .filter((rel) => !allow.includes(rel))
    .filter((rel) => pattern.test(readFileSync(path.join(COMPONENTS, rel), "utf8")));
}

describe("design tokens", () => {
  it("no component uses Tailwind's stock shadow-sm/md/lg", () => {
    expect(offenders(/(?<![\w-])(?:[\w[\]:-]+:)?shadow-(?:sm|md|lg)(?![\w-])/)).toEqual([]);
  });

  it("no component sets a stat size with a bare text-3xl/4xl", () => {
    expect(offenders(/(?<![\w-])(?:[\w[\]:-]+:)?text-(?:3|4)xl(?![\w-])/, HEADING_ALLOWLIST)).toEqual([]);
  });

  it("globals.css defines every token DESIGN.md names", () => {
    const css = readFileSync(CSS, "utf8");
    for (const token of [
      "shadow-primary",
      "shadow-primary-hover",
      "shadow-popover",
      "text-page-title",
      "text-item-title",
      "text-card-title",
      "text-body",
      "text-body-lg",
      "text-button",
      "text-badge",
      "text-caption",
      "text-stat",
      "text-hero",
    ]) {
      expect(css, token).toContain(`--${token}:`);
    }
  });
});
