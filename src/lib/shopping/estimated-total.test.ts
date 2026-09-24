import { describe, expect, it } from "vitest";
import { sumEstimatedPendingTotal } from "@/lib/shopping/estimated-total";

describe("sumEstimatedPendingTotal", () => {
  it("sums estimatedPrice across items, unmultiplied by quantity (per-unit, matching completeShoppingListAction)", () => {
    const total = sumEstimatedPendingTotal([
      { estimatedPrice: 24 },
      { estimatedPrice: 10.5 },
    ]);

    expect(total).toBe(34.5);
  });

  it("treats a null estimatedPrice as 0 rather than skipping the item or erroring", () => {
    const total = sumEstimatedPendingTotal([{ estimatedPrice: 20 }, { estimatedPrice: null }]);

    expect(total).toBe(20);
  });

  it("returns 0 for an empty list", () => {
    expect(sumEstimatedPendingTotal([])).toBe(0);
  });

  it("returns 0 when nothing has a price yet", () => {
    expect(sumEstimatedPendingTotal([{ estimatedPrice: null }, { estimatedPrice: null }])).toBe(0);
  });
});
