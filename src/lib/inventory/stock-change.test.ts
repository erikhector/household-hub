import { describe, expect, it } from "vitest";
import { nextQuantityAfterDelta } from "@/lib/inventory/stock-change";

describe("nextQuantityAfterDelta", () => {
  it("adds a positive delta", () => {
    expect(nextQuantityAfterDelta(2, 1)).toBe(3);
  });

  it("floors at zero instead of going negative", () => {
    expect(nextQuantityAfterDelta(0, -1)).toBe(0);
    expect(nextQuantityAfterDelta(0.5, -1)).toBe(0);
  });

  it("rounds away float drift to 2 decimals", () => {
    expect(nextQuantityAfterDelta(0.1, 0.2)).toBe(0.3);
  });
});
