// UX-42: every dashboard route, detail pages included, has a `loading.tsx`
// skeleton, so navigating to it shows the page's shape at once instead of
// the previous page frozen until the server answers. Same guard idea as
// page-coverage.test.ts: a new feature route without one fails `npm test`.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
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
