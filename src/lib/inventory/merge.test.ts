import { describe, expect, it } from "vitest";
import {
  convertBetweenUnits,
  mergeUnitFactor,
  planListRowMerges,
  planMerge,
  type MergeItem,
  type PendingListRow,
} from "./merge";

function mergeItem(id: string, overrides: Partial<MergeItem> = {}): MergeItem {
  return {
    id,
    name: id,
    unit: "pcs",
    quantity: 0,
    lowStockThreshold: 1,
    lastKnownPrice: null,
    expiresAt: null,
    expiresAtEstimated: false,
    category: "Pantry",
    barcode: null,
    conversions: [],
    ...overrides,
  };
}

const none = new Map<string, number>();

describe("mergeUnitFactor", () => {
  it("uses the generic table, then the keeper's conversions, then the merged item's backwards", () => {
    expect(mergeUnitFactor(mergeItem("k", { unit: "l" }), mergeItem("m", { unit: "dl" }))).toBe(0.1);
    expect(
      mergeUnitFactor(
        mergeItem("k", { unit: "pcs", conversions: [{ fromUnit: "g", factor: 0.0005 }] }),
        mergeItem("m", { unit: "kg" }),
      ),
    ).toBe(0.5);
    expect(
      mergeUnitFactor(
        mergeItem("k", { unit: "pcs" }),
        mergeItem("m", { unit: "dl", conversions: [{ fromUnit: "pcs", factor: 2 }] }),
      ),
    ).toBe(0.5);
    expect(mergeUnitFactor(mergeItem("k", { unit: "pcs" }), mergeItem("m", { unit: "dl" }))).toBeNull();
  });
});

describe("planMerge", () => {
  it("adds converted stock", () => {
    const { plan, missingFactor } = planMerge(
      mergeItem("k", { unit: "l", quantity: 1 }),
      [mergeItem("a", { unit: "dl", quantity: 5 }), mergeItem("b", { unit: "ml", quantity: 250 })],
      none,
    );
    expect(missingFactor).toEqual([]);
    expect(plan.quantity).toBe(1.75);
    expect(plan.items).toEqual([
      { id: "a", factor: 0.1, quantity: 0.5 },
      { id: "b", factor: 0.001, quantity: 0.25 },
    ]);
    expect(plan.conversions).toEqual([]);
  });

  it("asks for a factor when the units can't convert, and saves it as a conversion", () => {
    const keeper = mergeItem("k", { unit: "pcs", quantity: 2 });
    const merged = [mergeItem("m", { unit: "dl", quantity: 4 })];

    const missing = planMerge(keeper, merged, none);
    expect(missing.missingFactor).toEqual(["m"]);
    expect(missing.plan.quantity).toBe(2);

    const { plan, missingFactor } = planMerge(keeper, merged, new Map([["m", 0.5]]));
    expect(missingFactor).toEqual([]);
    expect(plan.quantity).toBe(4);
    expect(plan.conversions).toEqual([{ fromUnit: "dl", factor: 0.5 }]);
  });

  it("refuses an out-of-range factor", () => {
    const { badFactor } = planMerge(mergeItem("k"), [mergeItem("m", { unit: "dl" })], new Map([["m", 1e9]]));
    expect(badFactor).toEqual(["m"]);
  });

  it("re-expresses the merged item's conversions, and the keeper's own row wins", () => {
    const keeper = mergeItem("k", { unit: "pcs", conversions: [{ fromUnit: "g", factor: 0.01 }] });
    const merged = mergeItem("m", {
      unit: "dl",
      conversions: [
        { fromUnit: "g", factor: 0.5 },
        { fromUnit: "cup", factor: 2.4 },
        // Pointless on a keeper counted in pcs: it's the keeper's own unit.
        { fromUnit: "pcs", factor: 2 },
      ],
    });
    const { plan } = planMerge(keeper, [merged], none);
    // 1 dl = 0.5 pcs, read backwards from the merged item's own "1 pcs = 2 dl".
    expect(plan.items[0].factor).toBe(0.5);
    // The merged unit itself is saved too, so its recipe rows reconcile.
    expect(plan.conversions).toEqual([
      { fromUnit: "dl", factor: 0.5 },
      { fromUnit: "cup", factor: 1.2 },
    ]);
  });

  it("keeps the keeper's values and fills the empty ones from merged items", () => {
    const keeper = mergeItem("k", {
      lowStockThreshold: 0,
      category: "",
      lastKnownPrice: null,
      expiresAt: null,
      barcode: null,
    });
    const later = new Date("2026-10-10");
    const earlier = new Date("2026-10-01");
    const { plan } = planMerge(
      keeper,
      [
        mergeItem("a", { quantity: 1, expiresAt: later, lowStockThreshold: 2, lastKnownPrice: 20, barcode: "111" }),
        mergeItem("b", { quantity: 1, expiresAt: earlier, expiresAtEstimated: true, category: "Dairy", barcode: "222" }),
        // No stock, so its date is stale.
        mergeItem("c", { quantity: 0, expiresAt: new Date("2026-01-01") }),
      ],
      none,
    );
    expect(plan).toMatchObject({
      lowStockThreshold: 2,
      lastKnownPrice: 20,
      category: "Pantry",
      expiresAt: earlier,
      expiresAtEstimated: true,
      barcode: "111",
      droppedBarcodes: ["222"],
      fromMerged: { lowStockThreshold: true, lastKnownPrice: true, expiresAt: true, category: true, barcode: true },
    });

    const kept = planMerge(
      mergeItem("k", { lastKnownPrice: 5, expiresAt: later, barcode: "999", category: "Dairy" }),
      [mergeItem("a", { quantity: 1, expiresAt: earlier, lastKnownPrice: 20, barcode: "111", category: "Other" })],
      none,
    ).plan;
    expect(kept).toMatchObject({
      lastKnownPrice: 5,
      expiresAt: later,
      barcode: "999",
      category: "Dairy",
      lowStockThreshold: 1,
      droppedBarcodes: ["111"],
      fromMerged: { lowStockThreshold: false, lastKnownPrice: false, expiresAt: false, category: false, barcode: false },
    });
  });

  it("converts a taken threshold into the keeper's unit", () => {
    const { plan } = planMerge(
      mergeItem("k", { unit: "l", lowStockThreshold: 0 }),
      [mergeItem("m", { unit: "dl", lowStockThreshold: 5 })],
      none,
    );
    expect(plan.lowStockThreshold).toBe(0.5);
  });

  it("saves each merged name as an alias, except one equal to the keeper's", () => {
    const { plan } = planMerge(
      mergeItem("k", { name: "Egg" }),
      [mergeItem("a", { name: "eggs" }), mergeItem("b", { name: "EGG." }), mergeItem("c", { name: "Eggs" })],
      none,
    );
    expect(plan.aliases).toEqual(["eggs"]);
  });
});

describe("convertBetweenUnits", () => {
  it("uses the generic table, else goes through the item's unit", () => {
    expect(convertBetweenUnits(2, "l", "dl", { unit: "pcs" }, [])).toBe(20);
    expect(convertBetweenUnits(4, "dl", "pcs", { unit: "pcs" }, [{ fromUnit: "dl", factor: 0.5 }])).toBe(2);
    expect(convertBetweenUnits(1, "pcs", "dl", { unit: "pcs" }, [{ fromUnit: "dl", factor: 0.5 }])).toBe(2);
    expect(convertBetweenUnits(1, "dl", "pcs", { unit: "pcs" }, [])).toBeNull();
  });
});

describe("planListRowMerges", () => {
  const row = (id: string, overrides: Partial<PendingListRow>): PendingListRow => ({
    id,
    shoppingListId: "list-1",
    inventoryItemId: "keeper",
    quantity: 1,
    unit: "pcs",
    estimatedPrice: null,
    note: null,
    ...overrides,
  });
  const convert = (quantity: number, from: string, to: string) =>
    convertBetweenUnits(quantity, from, to, { unit: "pcs" }, []);

  it("adds a merged row into the keeper's row on the same list when the units convert", () => {
    const result = planListRowMerges(
      [
        row("k", { quantity: 2, estimatedPrice: 10 }),
        row("m", { inventoryItemId: "merged", quantity: 3, estimatedPrice: 5, note: "ripe" }),
        row("other-list", { inventoryItemId: "merged", shoppingListId: "list-2" }),
      ],
      "keeper",
      convert,
    );
    expect(result).toEqual({ updates: [{ id: "k", quantity: 5, estimatedPrice: 15, note: "ripe" }], deletes: ["m"] });
  });

  it("keeps both rows when the units don't convert", () => {
    const result = planListRowMerges(
      [row("k", {}), row("m", { inventoryItemId: "merged", unit: "dl" })],
      "keeper",
      convert,
    );
    expect(result).toEqual({ updates: [], deletes: [] });
  });

  it("adds merged rows together when the keeper has none on that list", () => {
    const result = planListRowMerges(
      [row("a", { inventoryItemId: "m1", unit: "l" }), row("b", { inventoryItemId: "m2", unit: "dl", quantity: 5 })],
      "keeper",
      convert,
    );
    expect(result).toEqual({ updates: [{ id: "a", quantity: 1.5, estimatedPrice: null, note: null }], deletes: ["b"] });
  });
});
