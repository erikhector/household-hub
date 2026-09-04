import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  CalendarDays,
  Wallet,
  Users,
  User,
} from "lucide-react";

export const SIDEBAR_COOKIE = "sidebar_expanded";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/inventory", label: "Inventory", icon: Package },
  { href: "/dashboard/shopping-list", label: "Shopping list", icon: ShoppingCart },
  { href: "/dashboard/meal-planning", label: "Meal planning", icon: CalendarDays },
  { href: "/dashboard/budget", label: "Budget", icon: Wallet },
  { href: "/dashboard/household", label: "Household", icon: Users },
  { href: "/dashboard/profile", label: "Profile", icon: User },
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
