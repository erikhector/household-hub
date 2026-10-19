import { describe, expect, it } from "vitest";
import {
  getPlannedExpenseStatus,
  isPlannedExpenseOutstanding,
  parseDueDate,
} from "@/lib/planned-expense-calc";

const oct = new Date(2026, 9, 1);
const nov = new Date(2026, 10, 1);
const dec = new Date(2026, 11, 1);

describe("getPlannedExpenseStatus", () => {
  it("is due when due this month and unpaid", () => {
    expect(
      getPlannedExpenseStatus({ dueDate: new Date(2026, 9, 20, 12), paidAt: null }, oct, nov),
    ).toBe("due");
  });

  it("is due on the 1st and on the last day of the month", () => {
    expect(
      getPlannedExpenseStatus({ dueDate: new Date(2026, 9, 1, 12), paidAt: null }, oct, nov),
    ).toBe("due");
    expect(
      getPlannedExpenseStatus({ dueDate: new Date(2026, 9, 31, 12), paidAt: null }, oct, nov),
    ).toBe("due");
  });

  it("is overdue when due before this month and unpaid", () => {
    expect(
      getPlannedExpenseStatus({ dueDate: new Date(2026, 8, 20, 12), paidAt: null }, oct, nov),
    ).toBe("overdue");
  });

  it("is upcoming when due next month", () => {
    expect(
      getPlannedExpenseStatus({ dueDate: new Date(2026, 10, 1, 12), paidAt: null }, oct, nov),
    ).toBe("upcoming");
  });

  it("is paid when paid this month", () => {
    expect(
      getPlannedExpenseStatus(
        { dueDate: new Date(2026, 9, 20, 12), paidAt: new Date(2026, 9, 25) },
        oct,
        nov,
      ),
    ).toBe("paid");
  });

  it("is not paid yet when paid exactly at monthEnd", () => {
    expect(
      getPlannedExpenseStatus({ dueDate: new Date(2026, 9, 20, 12), paidAt: nov }, oct, nov),
    ).toBe("due");
  });

  it("stays due in October when paid on 3 Nov, and is paid when viewed in November", () => {
    const bill = { dueDate: new Date(2026, 9, 20, 12), paidAt: new Date(2026, 10, 3) };
    expect(getPlannedExpenseStatus(bill, oct, nov)).toBe("due");
    expect(getPlannedExpenseStatus(bill, nov, dec)).toBe("paid");
  });

  it("stays overdue in a month between its due date and a later payment", () => {
    const bill = { dueDate: new Date(2026, 8, 20, 12), paidAt: new Date(2026, 11, 5) };
    expect(getPlannedExpenseStatus(bill, oct, nov)).toBe("overdue");
  });
});

describe("isPlannedExpenseOutstanding", () => {
  it("counts due and overdue only", () => {
    expect(isPlannedExpenseOutstanding("due")).toBe(true);
    expect(isPlannedExpenseOutstanding("overdue")).toBe(true);
    expect(isPlannedExpenseOutstanding("paid")).toBe(false);
    expect(isPlannedExpenseOutstanding("upcoming")).toBe(false);
  });
});

describe("parseDueDate", () => {
  it("stores a calendar day at UTC noon", () => {
    expect(parseDueDate("2026-11-20")).toEqual(new Date("2026-11-20T12:00:00Z"));
  });

  it("rejects an impossible date", () => {
    expect(parseDueDate("2026-02-31")).toBeNull();
    expect(parseDueDate("not-a-date")).toBeNull();
  });
});
