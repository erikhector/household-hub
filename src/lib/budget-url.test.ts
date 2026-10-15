import { describe, expect, it } from "vitest";
import { budgetHref, parseBudgetTab } from "@/lib/budget-url";

describe("parseBudgetTab", () => {
  it("accepts each known tab", () => {
    expect(parseBudgetTab("transactions")).toBe("transactions");
    expect(parseBudgetTab("manage")).toBe("manage");
    expect(parseBudgetTab("insights")).toBe("insights");
  });

  it("takes the first value of a repeated param", () => {
    expect(parseBudgetTab(["insights", "manage"])).toBe("insights");
  });

  it("falls back to overview for anything else", () => {
    expect(parseBudgetTab("bogus")).toBe("overview");
    expect(parseBudgetTab(undefined)).toBe("overview");
    expect(parseBudgetTab(null)).toBe("overview");
    expect(parseBudgetTab([])).toBe("overview");
  });
});

describe("budgetHref", () => {
  it("keeps every param, in a fixed order, encoded", () => {
    expect(
      budgetHref("/dashboard/budget", { category: "c1", tab: "transactions", household: "h 1", month: "2026-09" }),
    ).toBe("/dashboard/budget?month=2026-09&household=h%201&tab=transactions&category=c1");
  });

  it("leaves out overview, since it's the default tab", () => {
    expect(budgetHref("/x", { tab: "overview" })).toBe("/x");
  });

  it("leaves out empty and missing values", () => {
    expect(budgetHref("/x", { month: "2026-10", category: "", household: undefined })).toBe("/x?month=2026-10");
  });
});
