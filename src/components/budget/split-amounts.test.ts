import { describe, expect, it } from "vitest";
import { checkSplitForm, evenSplitAmounts, shareRemainder } from "./split-amounts";

describe("evenSplitAmounts", () => {
  it("returns an empty array for zero or negative member counts", () => {
    expect(evenSplitAmounts(100, 0)).toEqual([]);
    expect(evenSplitAmounts(100, -1)).toEqual([]);
  });

  it("splits evenly when the total divides cleanly", () => {
    expect(evenSplitAmounts(90, 3)).toEqual([30, 30, 30]);
  });

  it("distributes leftover cents to the first members, summing exactly to the total", () => {
    const amounts = evenSplitAmounts(10, 3);
    expect(amounts).toEqual([3.34, 3.33, 3.33]);
    expect(amounts.reduce((sum, a) => sum + a, 0)).toBeCloseTo(10, 10);
  });

  it("handles a single member (the whole amount)", () => {
    expect(evenSplitAmounts(42.5, 1)).toEqual([42.5]);
  });

  it("handles a zero total", () => {
    expect(evenSplitAmounts(0, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("checkSplitForm", () => {
  it("accepts a bill paid in full by one member", () => {
    expect(checkSplitForm("6000", { a: "3000", b: "3000" }, { a: "6000", b: "0" })).toEqual({
      shareTotal: 6000,
      paidTotal: 6000,
      shareRemainder: 0,
      shareMismatch: false,
      overpaid: false,
      leftDue: 0,
    });
  });

  it("reports what's left due on a partly paid bill", () => {
    const check = checkSplitForm("6000", { a: "3000", b: "3000" }, { a: "3000", b: "" });
    expect(check.leftDue).toBe(3000);
    expect(check.overpaid).toBe(false);
  });

  it("flags payments that add up to more than the bill", () => {
    expect(checkSplitForm("100", { a: "50", b: "50" }, { a: "80", b: "80" }).overpaid).toBe(true);
  });

  it("flags shares that don't add up to the bill", () => {
    expect(checkSplitForm("100", { a: "50", b: "40" }, {}).shareMismatch).toBe(true);
  });

  it("reports what's left of the bill to split while shares are typed", () => {
    const check = checkSplitForm("476", { a: "300", b: "" }, {});
    expect(check.shareRemainder).toBe(176);
    expect(check.shareMismatch).toBe(true);
  });

  it("counts a single unassigned cent as a mismatch", () => {
    expect(checkSplitForm("10", { a: "5", b: "4.99" }, {}).shareMismatch).toBe(true);
    expect(checkSplitForm("0.3", { a: "0.1", b: "0.2" }, {}).shareMismatch).toBe(false);
  });
});

describe("shareRemainder", () => {
  it("is what's left to split once the typed shares are taken out", () => {
    expect(shareRemainder("476", { a: "300", b: "0" })).toBe(176);
  });

  it("is negative when the shares add up to more than the bill", () => {
    expect(shareRemainder("100", { a: "80", b: "30" })).toBe(-10);
  });

  it("counts unparseable or empty shares (and an empty amount) as 0", () => {
    expect(shareRemainder("50", { a: "", b: "abc" })).toBe(50);
    expect(shareRemainder("", { a: "20" })).toBe(-20);
  });

  it("works in whole cents, so decimals don't leave floating-point noise", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point.
    expect(shareRemainder("0.3", { a: "0.1", b: "0.2" })).toBe(0);
    expect(shareRemainder("10", { a: "3.33", b: "3.33" })).toBe(3.34);
  });
});
