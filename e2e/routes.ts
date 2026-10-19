// Every page in the app, and the URL the UI suites visit it at. Shared by
// smoke.spec.ts, public.spec.ts and the UX scout's screenshot run, and
// checked against src/app/**/page.tsx by src/app/page-coverage.test.ts: a
// new page that isn't listed here fails `npm test`, so no screen can ship
// without at least the render + layout checks on desktop and mobile.
//
// Plain data with no Playwright import, so Vitest can load it too.

import { E2E_ITEM, E2E_SHOPPING_LIST } from "./seed-data";

export type UiRoute = {
  // The App Router pattern, exactly as the folder path spells it
  // (`/dashboard/shopping-list/[id]`). What the coverage test matches on.
  pattern: string;
  // A concrete URL for that pattern. Dynamic segments point at a row
  // e2e/seed.ts creates, or at a deliberately bogus token so the page's
  // "invalid / expired link" state is what gets rendered.
  path: string;
  // Where the page ends up, when it redirects rather than rendering at
  // `path` (defaults to `path`).
  finalPath?: RegExp;
};

// Pages behind the dashboard login. Visited with the seeded user's session.
export const DASHBOARD_ROUTES: UiRoute[] = [
  { pattern: "/dashboard", path: "/dashboard" },
  { pattern: "/dashboard/inventory", path: "/dashboard/inventory" },
  { pattern: "/dashboard/inventory/items", path: "/dashboard/inventory/items?filter=duplicates" },
  { pattern: "/dashboard/inventory/items/[id]", path: `/dashboard/inventory/items/${E2E_ITEM.id}` },
  { pattern: "/dashboard/shopping-list", path: "/dashboard/shopping-list" },
  {
    pattern: "/dashboard/shopping-list/[id]",
    path: `/dashboard/shopping-list/${E2E_SHOPPING_LIST.id}`,
  },
  { pattern: "/dashboard/meal-planning", path: "/dashboard/meal-planning" },
  { pattern: "/dashboard/tasks", path: "/dashboard/tasks" },
  { pattern: "/dashboard/budget", path: "/dashboard/budget" },
  { pattern: "/dashboard/personal-budget", path: "/dashboard/personal-budget" },
  { pattern: "/dashboard/household", path: "/dashboard/household" },
  { pattern: "/dashboard/notifications", path: "/dashboard/notifications" },
  { pattern: "/dashboard/profile", path: "/dashboard/profile" },
  { pattern: "/dashboard/whats-new", path: "/dashboard/whats-new" },
];

// Pages reachable without an account. Visited logged out.
export const PUBLIC_ROUTES: UiRoute[] = [
  { pattern: "/", path: "/" },
  { pattern: "/login", path: "/login" },
  { pattern: "/signup", path: "/signup" },
  { pattern: "/forgot-password", path: "/forgot-password" },
  { pattern: "/privacy", path: "/privacy" },
  { pattern: "/terms", path: "/terms" },
  { pattern: "/whats-new", path: "/whats-new" },
  { pattern: "/join/[token]", path: "/join/e2e-invalid-token" },
  { pattern: "/reset-password/[token]", path: "/reset-password/e2e-invalid-token" },
  { pattern: "/verify-email/[token]", path: "/verify-email/e2e-invalid-token" },
  { pattern: "/unsubscribe/[token]", path: "/unsubscribe/e2e-invalid-token" },
  { pattern: "/share/shopping-list/[token]", path: "/share/shopping-list/e2e-invalid-token" },
];

// Pages that can't be put into a stable state from a spec. Each needs a
// reason; the coverage test accepts these without a route entry.
export const UNCOVERED_ROUTES: Record<string, string> = {
  "/no-household":
    "Only reachable by a logged-in user with zero households; the seeded user has one, and its guard is unit-tested in src/lib/session.test.ts.",
};
