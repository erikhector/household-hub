import { describe, expect, it } from "vitest";
import { summarizeSharedCosts } from "./shared-costs-summary";

const debt = { householdId: "h1", householdName: "Home", owedToMembers: 470, owedToBills: 0 };

describe("summarizeSharedCosts", () => {
  it("has nothing to show without shares or balances", () => {
    expect(summarizeSharedCosts([], [])).toEqual({ monthShare: 0, hasAny: false });
  });

  it("sums only the user's expense shares", () => {
    const s = summarizeSharedCosts(
      [
        { amount: 470, type: "EXPENSE" },
        { amount: 30.5, type: "EXPENSE" },
        { amount: 100, type: "INCOME" },
        { amount: 50, type: "SAVINGS" },
      ],
      [],
    );
    expect(s.monthShare).toBeCloseTo(500.5);
    expect(s.hasAny).toBe(true);
  });

  it("shows a balance carried from an earlier month with no share this month", () => {
    expect(summarizeSharedCosts([], [debt])).toEqual({ monthShare: 0, hasAny: true });
  });
});
