// Guards the UI suites against drifting from the app: every page.tsx under
// src/app must be listed in e2e/routes.ts (or in its UNCOVERED_ROUTES with a
// reason), so smoke.spec.ts / public.spec.ts render it on desktop and
// mobile, in both languages, and the UX scout screenshots it. Same idea as
// src/lib/cookie-inventory.test.ts: adding a page without adding it there
// fails `npm test`, long before anyone has to remember to.
import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DASHBOARD_ROUTES, PUBLIC_ROUTES, UNCOVERED_ROUTES } from "../../e2e/routes";

const APP = path.resolve(__dirname);

// "/dashboard/shopping-list/[id]" for src/app/dashboard/shopping-list/[id]/page.tsx.
// Route groups ("(marketing)") don't appear in the URL, so they're dropped.
function pagePatterns(dir: string, segments: string[] = []): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return pagePatterns(full, /^\(.*\)$/.test(entry) ? segments : [...segments, entry]);
    }
    return entry === "page.tsx" ? [`/${segments.join("/")}`] : [];
  });
}

describe("e2e/routes.ts", () => {
  const listed = [...DASHBOARD_ROUTES, ...PUBLIC_ROUTES].map((route) => route.pattern);

  it("lists every page in src/app", () => {
    const pages = pagePatterns(APP);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(
        listed.includes(page) || page in UNCOVERED_ROUTES,
        `${page} has no entry in e2e/routes.ts: add it to DASHBOARD_ROUTES or PUBLIC_ROUTES`,
      ).toBe(true);
    }
  });

  it("lists no page that doesn't exist", () => {
    const pages = new Set(pagePatterns(APP));
    for (const pattern of [...listed, ...Object.keys(UNCOVERED_ROUTES)]) {
      expect(pages, `e2e/routes.ts lists ${pattern}, which has no page.tsx`).toContain(pattern);
    }
  });

  it("gives every route a concrete path, with no [segment] left in it", () => {
    for (const route of [...DASHBOARD_ROUTES, ...PUBLIC_ROUTES]) {
      expect(route.path, route.pattern).not.toMatch(/\[/);
    }
  });
});
