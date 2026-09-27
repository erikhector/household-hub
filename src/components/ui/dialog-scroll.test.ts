// Guards dialogs against a second, viewport-height scroller. DialogContent
// already scrolls (max-h-[85dvh] overflow-y-auto), and a dialog that wraps
// its body in its own max-h-[70vh] overflow-y-auto leaves two scrollers
// nested with nearly nothing outside the inner one. iOS Safari doesn't hand
// a swipe from one to the other, so the sheet got stuck and the dialog's
// buttons were out of reach (the recipe form, then the receipt, shelf-scan,
// put-away and mapping dialogs). Chromium chains the scroll, so e2e can't
// catch it; this does, the same way page-coverage.test.ts guards routes.
// Short fixed-height lists (max-h-64) are fine: the sheet stays swipeable
// around them.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const COMPONENTS = path.resolve(__dirname, "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") ? [full] : [];
  });
}

// A quoted className string with a viewport-relative max height.
const VIEWPORT_SCROLLER = /"[^"]*\bmax-h-\[\d+[ds]?vh\][^"]*"/g;

describe("dialog scroll containers", () => {
  it("no dialog nests a viewport-height scroller inside DialogContent", () => {
    const offenders = tsxFiles(COMPONENTS)
      .filter((file) => path.basename(file) !== "dialog.tsx")
      .filter((file) => readFileSync(file, "utf8").includes("@/components/ui/dialog"))
      .flatMap((file) =>
        (readFileSync(file, "utf8").match(VIEWPORT_SCROLLER) ?? [])
          .filter((cls) => /\boverflow-y-(auto|scroll)\b/.test(cls))
          .map((cls) => `${path.relative(COMPONENTS, file)}: ${cls}`),
      );
    expect(offenders, "let DialogContent do the scrolling (see src/components/ui/dialog.tsx)").toEqual([]);
  });
});
