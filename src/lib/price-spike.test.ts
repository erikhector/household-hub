import { describe, expect, it } from "vitest";
import {
  PRICE_SPIKE_MAX_AGE_DAYS,
  PRICE_SPIKE_TRAILING_WINDOW,
  detectPriceSpike,
  type PricePoint,
} from "./price-spike";

const NOW = new Date("2026-09-25T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function point(price: number, quantity: number | null = 1, unit: string | null = "pcs", age = 7): PricePoint {
  return { price, quantity, unit, date: daysAgo(age) };
}

// Three ordinary purchases at 40 — a baseline most tests build on.
const USUAL = [point(40, 1, "pcs", 30), point(40, 1, "pcs", 20), point(40, 1, "pcs", 10)];

describe("detectPriceSpike", () => {
  it("flags a price well above the usual one", () => {
    const spike = detectPriceSpike(USUAL, [point(60, 1, "pcs", 0)], NOW);
    expect(spike).toEqual({ unitPrice: 60, medianUnitPrice: 40, increasePercent: 50, extraCost: 20 });
  });

  it("stays quiet for a normal price", () => {
    expect(detectPriceSpike(USUAL, [point(42)], NOW)).toBeNull();
  });

  it("stays quiet for a price drop", () => {
    expect(detectPriceSpike(USUAL, [point(20)], NOW)).toBeNull();
  });

  describe("enough history", () => {
    it("needs at least three comparable prior prices", () => {
      expect(detectPriceSpike(USUAL.slice(0, 2), [point(100)], NOW)).toBeNull();
      expect(detectPriceSpike(USUAL, [point(100)], NOW)).not.toBeNull();
    });

    it("stays quiet with no history at all", () => {
      expect(detectPriceSpike([], [point(100)], NOW)).toBeNull();
    });

    it("ignores rows recorded before quantity/unit were tracked", () => {
      const legacy = [point(40, null, null), point(40, null, null), point(40, null, null)];
      expect(detectPriceSpike(legacy, [point(100)], NOW)).toBeNull();
      expect(detectPriceSpike([...legacy, ...USUAL.slice(0, 2)], [point(100)], NOW)).toBeNull();
    });

    it("ignores prior prices older than the max age", () => {
      const old = USUAL.map((p) => ({ ...p, date: daysAgo(PRICE_SPIKE_MAX_AGE_DAYS + 1) }));
      expect(detectPriceSpike(old, [point(100)], NOW)).toBeNull();
    });

    it("ignores zero/negative/non-finite prior prices", () => {
      const junk = [point(0), point(-5), point(Number.NaN)];
      expect(detectPriceSpike([...junk, ...USUAL.slice(0, 2)], [point(100)], NOW)).toBeNull();
    });
  });

  describe("materially above: ratio AND absolute floor", () => {
    it("fires exactly at the 25% ratio when the extra cost clears the floor", () => {
      expect(detectPriceSpike(USUAL, [point(50)], NOW)?.increasePercent).toBe(25);
    });

    it("stays quiet just under the ratio", () => {
      expect(detectPriceSpike(USUAL, [point(49.9)], NOW)).toBeNull();
    });

    it("stays quiet when a cheap item jumps by a big ratio but only a few kronor", () => {
      // 10 → 18 is +80% but only 8 kr extra.
      const cheap = [point(10), point(10), point(10)];
      expect(detectPriceSpike(cheap, [point(18)], NOW)).toBeNull();
      // 10 → 20 is exactly the 10 kr floor.
      expect(detectPriceSpike(cheap, [point(20)], NOW)?.increasePercent).toBe(100);
    });

    it("stays quiet when an expensive item moves a lot of kronor but a small ratio", () => {
      const pricey = [point(400), point(400), point(400)];
      expect(detectPriceSpike(pricey, [point(460)], NOW)).toBeNull();
    });

    it("measures the absolute floor on the whole line, so buying more of a small jump counts", () => {
      // 8 → 12 per pack is +50% but 4 kr; three packs is 12 kr extra.
      const cheap = [point(8), point(8), point(8)];
      expect(detectPriceSpike(cheap, [point(12, 1)], NOW)).toBeNull();
      expect(detectPriceSpike(cheap, [point(36, 3)], NOW)?.extraCost).toBeCloseTo(12);
    });
  });

  describe("per unit, like for like", () => {
    it("doesn't treat buying two packs as a price jump", () => {
      expect(detectPriceSpike(USUAL, [point(80, 2)], NOW)).toBeNull();
    });

    it("normalizes prior multi-pack purchases per unit", () => {
      const history = [point(80, 2), point(120, 3), point(40, 1)];
      expect(detectPriceSpike(history, [point(60, 1)], NOW)?.medianUnitPrice).toBe(40);
    });

    it("converts between compatible units", () => {
      // 40 kr/kg historically, bought as 500 g packs and 1 kg bags.
      const history = [point(20, 500, "g"), point(40, 1, "kg"), point(20, 0.5, "kg")];
      expect(detectPriceSpike(history, [point(25, 500, "g")], NOW)).toBeNull();
      const spike = detectPriceSpike(history, [point(60, 1, "kg")], NOW);
      expect(spike?.increasePercent).toBe(50);
      expect(spike?.medianUnitPrice).toBeCloseTo(40);
    });

    it("matches units case- and whitespace-insensitively", () => {
      const history = [point(40, 1, "Pack"), point(40, 1, " pack"), point(40, 1, "PACK")];
      expect(detectPriceSpike(history, [point(60, 1, "pack")], NOW)?.increasePercent).toBe(50);
    });

    it("skips prior rows in an incompatible unit", () => {
      // Weight vs volume, and an unknown count unit vs pcs, never compare.
      const history = [point(10, 1, "l"), point(10, 1, "l"), point(10, 1, "can"), ...USUAL.slice(0, 2)];
      expect(detectPriceSpike(history, [point(100, 1, "kg")], NOW)).toBeNull();
      expect(detectPriceSpike(history, [point(100, 1, "pcs")], NOW)).toBeNull();
    });

    it("stays quiet when the new line itself has no usable quantity/unit", () => {
      expect(detectPriceSpike(USUAL, [point(100, null)], NOW)).toBeNull();
      expect(detectPriceSpike(USUAL, [point(100, 0)], NOW)).toBeNull();
      expect(detectPriceSpike(USUAL, [point(100, 1, "  ")], NOW)).toBeNull();
      expect(detectPriceSpike(USUAL, [point(0)], NOW)).toBeNull();
    });
  });

  describe("trailing median", () => {
    it("isn't dragged by one past sale or one past spike", () => {
      const history = [point(10), point(40), point(40), point(40), point(200)];
      expect(detectPriceSpike(history, [point(60)], NOW)?.medianUnitPrice).toBe(40);
    });

    it("only looks at the most recent window, so a price that's stayed up becomes normal", () => {
      const old = Array.from({ length: 20 }, (_, i) => point(40, 1, "pcs", 200 - i));
      const recent = Array.from({ length: PRICE_SPIKE_TRAILING_WINDOW }, (_, i) => point(60, 1, "pcs", 50 - i));
      expect(detectPriceSpike([...old, ...recent], [point(62)], NOW)).toBeNull();
      // Without the window, the 20 older rows at 40 would still dominate.
      expect(detectPriceSpike([...old, ...recent.slice(0, 4)], [point(62)], NOW)).not.toBeNull();
    });

    it("accepts prior rows in any order", () => {
      const shuffled = [point(40, 1, "pcs", 3), point(40, 1, "pcs", 90), point(40, 1, "pcs", 40)];
      expect(detectPriceSpike(shuffled, [point(60)], NOW)?.increasePercent).toBe(50);
    });
  });

  describe("several lines for one item in one batch", () => {
    it("pools them into one purchase instead of deciding per line", () => {
      // The same item twice on one receipt at the spiked price: one decision,
      // quantity 2, extra cost 40.
      const spike = detectPriceSpike(USUAL, [point(60), point(60)], NOW);
      expect(spike).toEqual({ unitPrice: 60, medianUnitPrice: 40, increasePercent: 50, extraCost: 40 });
    });

    it("lets a discount line pull the effective price back down", () => {
      // 60 + 30 for two = 45 each, +12.5%: not a spike.
      expect(detectPriceSpike(USUAL, [point(60), point(30)], NOW)).toBeNull();
    });

    it("leaves out a batch line in a unit it can't convert", () => {
      const spike = detectPriceSpike(USUAL, [point(60, 1, "pcs"), point(5, 1, "l")], NOW);
      expect(spike?.unitPrice).toBe(60);
    });
  });
});
