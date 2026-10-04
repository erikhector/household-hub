import { describe, expect, it } from "vitest";
import { median, round2 } from "@/lib/math";

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.236)).toBe(1.24);
    expect(round2(5)).toBe(5);
  });
});

describe("median", () => {
  it("takes the middle value of an odd count, whatever the order", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the middle pair of an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("doesn't mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});
