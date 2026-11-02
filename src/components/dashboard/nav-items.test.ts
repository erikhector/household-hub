import { describe, expect, it } from "vitest";
import { navAccentColor, navItemForPath, primaryMobileNavItems } from "./nav-items";

// navItemForPath drives PageTitle's section hue, so a wrong match tints a
// page with another section's colour. The cases below pin the three branches
// that matter: "/dashboard" matches only exactly (every other path starts
// with it), the longest matching href wins, and a path outside any section
// maps to nothing.
describe("navItemForPath", () => {
  it("maps /dashboard to overview", () => {
    expect(navItemForPath("/dashboard")?.key).toBe("overview");
  });

  it("maps /dashboard/budget to budget, not overview", () => {
    expect(navItemForPath("/dashboard/budget")?.key).toBe("budget");
  });

  it("maps /dashboard/personal-budget to personalBudget, not budget", () => {
    expect(navItemForPath("/dashboard/personal-budget")?.key).toBe("personalBudget");
  });

  it("maps a nested path to its own section", () => {
    expect(navItemForPath("/dashboard/shopping-list/abc")?.key).toBe("shoppingList");
  });

  it("returns undefined for a page that is not a nav section", () => {
    expect(navItemForPath("/dashboard/whats-new")).toBeUndefined();
  });
});

// UX-167: the title bar's hue must name one section.
describe("navAccentColor", () => {
  it("gives every coloured primary tab its own hue", () => {
    const hues = primaryMobileNavItems.map((item) => item.color).filter(Boolean);
    expect(hues.length).toBeGreaterThan(0);
    expect(new Set(hues).size).toBe(hues.length);
  });

  it("draws no bar for a More-menu section", () => {
    for (const path of ["/dashboard/budget", "/dashboard/tasks", "/dashboard/household", "/dashboard/profile"]) {
      expect(navAccentColor(navItemForPath(path))).toBeUndefined();
    }
  });

  it("draws the bar for a primary tab", () => {
    expect(navAccentColor(navItemForPath("/dashboard/inventory"))).toBe("chart-1");
  });
});
