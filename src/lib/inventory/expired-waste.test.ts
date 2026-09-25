import { describe, expect, it } from "vitest";
import {
  computeExpiredWaste,
  isExpiredUnused,
  type ExpiredWasteCandidate,
} from "@/lib/inventory/expired-waste";

const MONTH_START = new Date(2026, 8, 1);
const MONTH_END = new Date(2026, 9, 1);
const NOW = new Date(2026, 8, 20, 12);

function candidate(overrides: Partial<ExpiredWasteCandidate> = {}): ExpiredWasteCandidate {
  return {
    id: "i1",
    name: "Milk",
    quantity: 1,
    expiresAt: new Date(2026, 8, 10),
    expiresAtEstimated: false,
    lastKnownPrice: 20,
    updatedAt: new Date(2026, 8, 5),
    ...overrides,
  };
}

describe("isExpiredUnused", () => {
  it("counts an item still in stock past its date", () => {
    expect(isExpiredUnused(candidate(), MONTH_START, MONTH_END, NOW)).toBe(true);
  });

  it("ignores items with no expiry date", () => {
    expect(isExpiredUnused(candidate({ expiresAt: null }), MONTH_START, MONTH_END, NOW)).toBe(false);
  });

  it("ignores a date later this month that hasn't passed yet", () => {
    const later = candidate({ expiresAt: new Date(2026, 8, 25) });
    expect(isExpiredUnused(later, MONTH_START, MONTH_END, NOW)).toBe(false);
  });

  it("ignores dates outside the month (end exclusive)", () => {
    const lastMonth = candidate({ expiresAt: new Date(2026, 7, 31) });
    const nextMonthStart = candidate({ expiresAt: MONTH_END });
    const farNow = new Date(2026, 11, 1);
    expect(isExpiredUnused(lastMonth, MONTH_START, MONTH_END, NOW)).toBe(false);
    expect(isExpiredUnused(nextMonthStart, MONTH_START, MONTH_END, farNow)).toBe(false);
  });

  it("counts an empty item that was emptied on or after its date", () => {
    const tossed = candidate({ quantity: 0, updatedAt: new Date(2026, 8, 12) });
    const tossedSameInstant = candidate({ quantity: 0, updatedAt: new Date(2026, 8, 10) });
    expect(isExpiredUnused(tossed, MONTH_START, MONTH_END, NOW)).toBe(true);
    expect(isExpiredUnused(tossedSameInstant, MONTH_START, MONTH_END, NOW)).toBe(true);
  });

  it("never counts an empty item that was used up before its date", () => {
    const eaten = candidate({ quantity: 0, updatedAt: new Date(2026, 8, 8) });
    expect(isExpiredUnused(eaten, MONTH_START, MONTH_END, NOW)).toBe(false);
  });
});

describe("computeExpiredWaste", () => {
  it("returns an empty summary when nothing qualifies", () => {
    expect(computeExpiredWaste([], MONTH_START, MONTH_END, NOW)).toEqual({
      items: [],
      confirmedValue: 0,
      estimatedValue: 0,
      unpricedCount: 0,
    });
  });

  it("values each item once at its last known price, not price × quantity", () => {
    const summary = computeExpiredWaste(
      [candidate({ quantity: 500, lastKnownPrice: 24.5 })],
      MONTH_START,
      MONTH_END,
      NOW,
    );
    expect(summary.confirmedValue).toBe(24.5);
    expect(summary.items[0].value).toBe(24.5);
  });

  it("keeps estimated dates out of the headline figure", () => {
    const summary = computeExpiredWaste(
      [
        candidate({ id: "a", lastKnownPrice: 10 }),
        candidate({ id: "b", name: "Bread", expiresAtEstimated: true, lastKnownPrice: 30 }),
      ],
      MONTH_START,
      MONTH_END,
      NOW,
    );
    expect(summary.confirmedValue).toBe(10);
    expect(summary.estimatedValue).toBe(30);
    // Real dates sort first even when an estimate is worth more.
    expect(summary.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("counts unpriced items without adding to either sum", () => {
    const summary = computeExpiredWaste(
      [candidate({ lastKnownPrice: null }), candidate({ id: "z", lastKnownPrice: 0 })],
      MONTH_START,
      MONTH_END,
      NOW,
    );
    expect(summary.unpricedCount).toBe(2);
    expect(summary.confirmedValue).toBe(0);
    expect(summary.items).toHaveLength(2);
    expect(summary.items.every((i) => i.value === null)).toBe(true);
  });

  it("rounds sums to cents and sorts by value within a group", () => {
    const summary = computeExpiredWaste(
      [
        candidate({ id: "a", name: "A", lastKnownPrice: 0.1 }),
        candidate({ id: "b", name: "B", lastKnownPrice: 0.2 }),
        candidate({ id: "c", name: "C", quantity: 0, updatedAt: new Date(2026, 8, 1) }),
      ],
      MONTH_START,
      MONTH_END,
      NOW,
    );
    expect(summary.confirmedValue).toBe(0.3);
    expect(summary.items.map((i) => i.id)).toEqual(["b", "a"]);
  });
});
