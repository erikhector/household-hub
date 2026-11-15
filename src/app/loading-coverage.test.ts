// UX-42: every dashboard route, detail pages included, has a `loading.tsx`
// skeleton, so navigating to it shows the page's shape at once instead of
// the previous page frozen until the server answers. Same guard idea as
// page-coverage.test.ts: a new feature route without one fails `npm test`.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const DASHBOARD = path.resolve(__dirname, "dashboard");

// Every folder under dashboard/ that holds a page.tsx, nested detail pages
// (shopping-list/[id], inventory/items/[id]) included.
function pageFolders(dir: string): string[] {
  const here = existsSync(path.join(DASHBOARD, dir, "page.tsx")) && dir !== "" ? [dir] : [];
  const children = readdirSync(path.join(DASHBOARD, dir)).filter((entry) =>
    statSync(path.join(DASHBOARD, dir, entry)).isDirectory(),
  );
  return [...here, ...children.flatMap((child) => pageFolders(path.join(dir, child)))];
}

describe("dashboard loading skeletons", () => {
  const features = pageFolders("");

  it("finds the feature routes", () => {
    expect(features.length).toBeGreaterThan(0);
    expect(features).toContain(path.join("shopping-list", "[id]"));
  });

  it.each(features)("%s has a loading.tsx", (feature) => {
    expect(existsSync(path.join(DASHBOARD, feature, "loading.tsx"))).toBe(true);
  });
});

// MAINT-31, MAINT-102: these pages arrive in one piece behind `loading.tsx`.
// Their sections used to stream in behind separate Suspense fallbacks, and
// on a loaded machine the browser painted them one at a time, each moving
// what was already on screen (CLS 0.0647 on household, 0.298 on inventory,
// against e2e/cls.spec.ts's 0.05 budget). That spec can't slow the server's
// own streaming, so it only caught this now and then; this guard is the
// steady check. To stream a section on one of these pages again, first show
// that its fallback has the section's exact height in every state.
describe("pages that arrive in one piece", () => {
  it.each(["household", "inventory"])("%s/page.tsx has no Suspense boundary", (feature) => {
    const source = readFileSync(path.join(DASHBOARD, feature, "page.tsx"), "utf8");
    expect(source).not.toMatch(/<Suspense\b/);
  });
});
