// Tests computePersonalFixedInsights — Personal Budget's "Fixed income &
// costs" card on the Insights tab (BUDGET-7). The same dataset is run
// without and then with the user's shares of split household bills, so the
// difference is exactly what the shared side adds.
import { describe, expect, it } from "vitest";
import {
  computePersonalFixedInsights,
  type PersonalFixedInsightsInput,
} from "./personal-fixed-insights";

const monthEnd = new Date(2026, 9, 1); // viewing September 2026
const referenceDate = new Date(2026, 8, 15);
const createdAt = new Date(2026, 0, 1);

const personalOnly: PersonalFixedInsightsInput = {
  templates: [
    { id: "salary", name: "Salary", amount: 30000, frequency: "MONTHLY", type: "INCOME", active: true, createdAt },
    { id: "gym", name: "Gym", amount: 300, frequency: "MONTHLY", type: "EXPENSE", active: true, createdAt },
  ],
  transactions: [
    { type: "INCOME", amount: 30000, date: new Date(2026, 8, 25), recurringTemplateId: "salary" },
    { type: "EXPENSE", amount: 300, date: new Date(2026, 7, 2), recurringTemplateId: "gym" },
  ],
  sharedTemplates: [],
  sharedTransactions: [],
  monthEnd,
  referenceDate,
  monthsBack: 3,
  sharedLabel: "Shared",
};

const withShared: PersonalFixedInsightsInput = {
  ...personalOnly,
  sharedTemplates: [
    // My half of the household's 12000 rent.
    { id: "rent", name: "Rent", amount: 6000, frequency: "MONTHLY", type: "EXPENSE", active: true, createdAt },
    // A paused shared template doesn't count, same as a personal one.
    { id: "old", name: "Old", amount: 999, frequency: "MONTHLY", type: "EXPENSE", active: false, createdAt },
  ],
  sharedTransactions: [
    // September's and August's rent, my share of each.
    { type: "EXPENSE", amount: 6000, date: new Date(2026, 8, 1), recurringTemplateId: "rent" },
    { type: "EXPENSE", amount: 6000, date: new Date(2026, 7, 1), recurringTemplateId: "rent" },
  ],
};

describe("computePersonalFixedInsights", () => {
  it("adds only the user's share of shared recurring bills", () => {
    const before = computePersonalFixedInsights(personalOnly);
    const after = computePersonalFixedInsights(withShared);

    expect(before.summary).toEqual({ monthlyIncome: 30000, monthlyExpense: 300, monthlySavings: 0 });
    expect(after.summary).toEqual({ monthlyIncome: 30000, monthlyExpense: 6300, monthlySavings: 0 });

    expect(before.expenseBreakdown).toEqual([{ id: "gym", name: "Gym", total: 300 }]);
    // Labelled and keyed apart from personal items, like PeriodSummary's
    // shared rows, so a personal "Rent" and a shared "Rent" never merge.
    expect(after.expenseBreakdown).toEqual([
      { id: "shared:rent", name: "Rent (Shared)", total: 6000 },
      { id: "gym", name: "Gym", total: 300 },
    ]);
    expect(after.incomeBreakdown).toEqual(before.incomeBreakdown);

    expect(before.monthlyTotals).toEqual([
      { month: "2026-07", income: 0, expense: 0, savings: 0 },
      { month: "2026-08", income: 0, expense: 300, savings: 0 },
      { month: "2026-09", income: 30000, expense: 0, savings: 0 },
    ]);
    expect(after.monthlyTotals).toEqual([
      { month: "2026-07", income: 0, expense: 0, savings: 0 },
      { month: "2026-08", income: 0, expense: 6300, savings: 0 },
      { month: "2026-09", income: 30000, expense: 6000, savings: 0 },
    ]);
  });

  it("lets a shared share tip the balance status", () => {
    const tight = computePersonalFixedInsights({
      ...withShared,
      sharedTemplates: [
        { id: "rent", name: "Rent", amount: 28000, frequency: "MONTHLY", type: "EXPENSE", active: true, createdAt },
      ],
    });
    expect(computePersonalFixedInsights(personalOnly).balanceStatus).toBe("balanced");
    expect(tight.balanceStatus).toBe("tight");
  });

  it("ignores shared bills not logged from a recurring template", () => {
    const result = computePersonalFixedInsights({
      ...personalOnly,
      sharedTransactions: [{ type: "EXPENSE", amount: 500, date: new Date(2026, 8, 3), recurringTemplateId: null }],
    });
    expect(result.monthlyTotals).toEqual(computePersonalFixedInsights(personalOnly).monthlyTotals);
  });
});
