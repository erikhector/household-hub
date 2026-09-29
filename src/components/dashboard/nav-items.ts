import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  CalendarDays,
  Wallet,
  PiggyBank,
  Users,
  User,
  ListChecks,
} from "lucide-react";

import type { Dictionary } from "@/lib/i18n/get-dictionary";

// The slice of the dictionary the dashboard shell (Sidebar, BottomNav) reads.
// The layout passes only these sub-objects across the server/client boundary:
// a client prop is serialized into every dashboard document and every
// layout-re-rendering action response, and the full dictionary is ~87 KB
// against ~7 KB actually used here (PERF-5).
export type ShellDictionary = Pick<Dictionary, "nav" | "notifications" | "language" | "theme">;

export const SIDEBAR_COOKIE = "sidebar_expanded";

export type NavKey =
  | "overview"
  | "inventory"
  | "shoppingList"
  | "mealPlanning"
  | "tasks"
  | "budget"
  | "personalBudget"
  | "household"
  | "profile";

// Each section (other than the neutral "overview"/home tab) gets one of the
// app's existing --chart-1..5 hues as a wayfinding accent, applied as a
// tinted icon tile (see NAV_ICON_TILE_CLASSES below) — the same "recognize
// the screen by color before reading the label" pattern Apple's system apps
// use. Deliberately skips chart-4, whose hue is identical to --primary (the
// active-row fill color), to avoid a section tile reading as indistinguishable
// from the active state. Full literal class strings below (not built from
// the token name) so Tailwind's JIT scanner can see them statically.
export type NavColor = "chart-1" | "chart-2" | "chart-3" | "chart-5";

export const NAV_ICON_TILE_CLASSES: Record<NavColor, string> = {
  "chart-1": "bg-chart-1/15 text-chart-1",
  "chart-2": "bg-chart-2/15 text-chart-2",
  "chart-3": "bg-chart-3/15 text-chart-3",
  "chart-5": "bg-chart-5/15 text-chart-5",
};

export type NavItem = {
  href: string;
  key: NavKey;
  icon: ComponentType<{ className?: string }>;
  color?: NavColor;
};

export const navItems: NavItem[] = [
  { href: "/dashboard", key: "overview", icon: LayoutDashboard },
  { href: "/dashboard/inventory", key: "inventory", icon: Package, color: "chart-1" },
  { href: "/dashboard/shopping-list", key: "shoppingList", icon: ShoppingCart, color: "chart-2" },
  { href: "/dashboard/meal-planning", key: "mealPlanning", icon: CalendarDays, color: "chart-3" },
  { href: "/dashboard/tasks", key: "tasks", icon: ListChecks, color: "chart-5" },
  { href: "/dashboard/budget", key: "budget", icon: Wallet, color: "chart-1" },
  { href: "/dashboard/personal-budget", key: "personalBudget", icon: PiggyBank, color: "chart-2" },
  { href: "/dashboard/household", key: "household", icon: Users, color: "chart-3" },
  { href: "/dashboard/profile", key: "profile", icon: User, color: "chart-5" },
];

// The mobile bottom bar only has room for ~5 icons. These four see the most
// day-to-day use; everything else lives behind the "More" menu.
//
// Meal planning takes Household budget's old slot here
// (docs/archive/UX_FRICTION_BACKLOG.md item 5): pantry/shopping/meal-planning are the
// hands-on trio someone reaches for while actually cooking or shopping —
// "what's for dinner" standing in the kitchen is arguably meal planning's
// primary real-world moment, same immediacy as the other two. Budget
// (checked periodically, not mid-task) joins Personal budget, Tasks,
// Household, and Profile behind "More" instead.
const primaryMobileHrefs = new Set([
  "/dashboard",
  "/dashboard/inventory",
  "/dashboard/shopping-list",
  "/dashboard/meal-planning",
]);

export const primaryMobileNavItems = navItems.filter((item) => primaryMobileHrefs.has(item.href));
export const overflowMobileNavItems = navItems.filter((item) => !primaryMobileHrefs.has(item.href));

export function isNavItemActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}
