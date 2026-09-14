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

export type NavItem = {
  href: string;
  key: NavKey;
  icon: ComponentType<{ className?: string }>;
};

export const navItems: NavItem[] = [
  { href: "/dashboard", key: "overview", icon: LayoutDashboard },
  { href: "/dashboard/inventory", key: "inventory", icon: Package },
  { href: "/dashboard/shopping-list", key: "shoppingList", icon: ShoppingCart },
  { href: "/dashboard/meal-planning", key: "mealPlanning", icon: CalendarDays },
  { href: "/dashboard/tasks", key: "tasks", icon: ListChecks },
  { href: "/dashboard/budget", key: "budget", icon: Wallet },
  { href: "/dashboard/personal-budget", key: "personalBudget", icon: PiggyBank },
  { href: "/dashboard/household", key: "household", icon: Users },
  { href: "/dashboard/profile", key: "profile", icon: User },
];

// The mobile bottom bar only has room for ~5 icons. These four see the most
// day-to-day use; everything else lives behind the "More" menu.
//
// Meal planning takes Household budget's old slot here
// (UX_FRICTION_BACKLOG.md item 5): pantry/shopping/meal-planning are the
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
