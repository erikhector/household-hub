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
} from "lucide-react";

export const SIDEBAR_COOKIE = "sidebar_expanded";

export type NavKey =
  | "overview"
  | "inventory"
  | "shoppingList"
  | "mealPlanning"
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
  { href: "/dashboard/budget", key: "budget", icon: Wallet },
  { href: "/dashboard/personal-budget", key: "personalBudget", icon: PiggyBank },
  { href: "/dashboard/household", key: "household", icon: Users },
  { href: "/dashboard/profile", key: "profile", icon: User },
];

// The mobile bottom bar only has room for ~5 icons. These four see the most
// day-to-day use; everything else lives behind the "More" menu.
const primaryMobileHrefs = new Set([
  "/dashboard",
  "/dashboard/inventory",
  "/dashboard/shopping-list",
  "/dashboard/budget",
]);

export const primaryMobileNavItems = navItems.filter((item) => primaryMobileHrefs.has(item.href));
export const overflowMobileNavItems = navItems.filter((item) => !primaryMobileHrefs.has(item.href));

export function isNavItemActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}
