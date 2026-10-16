import { describe, expect, it } from "vitest";
import { countPriced, sumEstimatedPendingTotal } from "@/lib/shopping/estimated-total";

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

describe("countPriced (UX-87)", () => {
  it("counts the rows that carry a price out of all rows", () => {
    expect(countPriced([{ estimatedPrice: 24.9 }, { estimatedPrice: null }, { estimatedPrice: null }])).toEqual({
      priced: 1,
      total: 3,
    });
  });

  it("counts a price of 0 as priced, matching the sum's non-null rule", () => {
    expect(countPriced([{ estimatedPrice: 0 }])).toEqual({ priced: 1, total: 1 });
  });

  it("is 0 of 0 for no rows", () => {
    expect(countPriced([])).toEqual({ priced: 0, total: 0 });
  });
});
