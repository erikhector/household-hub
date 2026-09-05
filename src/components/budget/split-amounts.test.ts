import { describe, expect, it } from "vitest";
import { evenSplitAmounts } from "./split-amounts";

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
