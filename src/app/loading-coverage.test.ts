// UX-42: every top-level dashboard feature route has a `loading.tsx`
// skeleton, so navigating to it shows the page's shape at once instead of
// the previous page frozen until the server answers. Same guard idea as
// page-coverage.test.ts: a new feature route without one fails `npm test`.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const DASHBOARD = path.resolve(__dirname, "dashboard");

describe("dashboard loading skeletons", () => {
  const features = readdirSync(DASHBOARD).filter(
    (entry) => statSync(path.join(DASHBOARD, entry)).isDirectory() && existsSync(path.join(DASHBOARD, entry, "page.tsx")),
  );

  it("finds the feature routes", () => {
    expect(features.length).toBeGreaterThan(0);
  });

  it.each(features)("%s has a loading.tsx", (feature) => {
    expect(existsSync(path.join(DASHBOARD, feature, "loading.tsx"))).toBe(true);
  });
});
