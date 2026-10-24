// Tests the pure GAP-4 helpers in src/lib/shopping/list-templates.ts.
import { describe, expect, it } from "vitest";
import { buildTemplateItems, resolveTemplateRows } from "@/lib/shopping/list-templates";

describe("buildTemplateItems", () => {
  it("keeps every line, checked off or not, in order", () => {
    expect(
      buildTemplateItems([
        { name: "Milk", quantity: 2, unit: "l", inventoryItemId: "milk" },
        { name: "Charcoal", quantity: 1, unit: "bag", inventoryItemId: null },
      ]),
    ).toEqual([
      { name: "Milk", quantity: 2, unit: "l", inventoryItemId: "milk" },
      { name: "Charcoal", quantity: 1, unit: "bag", inventoryItemId: null },
    ]);
  });

  it("collapses duplicate name+unit lines, summing quantities and keeping a link", () => {
    expect(
      buildTemplateItems([
        { name: "Milk", quantity: 1, unit: "l", inventoryItemId: null },
        { name: " milk ", quantity: 2, unit: "l", inventoryItemId: "milk" },
        { name: "Milk", quantity: 6, unit: "pcs", inventoryItemId: null },
      ]),
    ).toEqual([
      { name: "Milk", quantity: 3, unit: "l", inventoryItemId: "milk" },
      { name: "Milk", quantity: 6, unit: "pcs", inventoryItemId: null },
    ]);
  });

  it("drops blank names", () => {
    expect(buildTemplateItems([{ name: "  ", quantity: 1, unit: "pcs", inventoryItemId: null }])).toEqual([]);
  });
});

describe("resolveTemplateRows", () => {
  const inventory = [
    { id: "milk", name: "Milk", unit: "l", lastKnownPrice: 12.5 },
    { id: "bread", name: "Sourdough bread", unit: "pcs", lastKnownPrice: null },
  ];

  it("keeps a saved link that still exists and picks up its lastKnownPrice", () => {
    expect(
      resolveTemplateRows([{ name: "Mjölk", quantity: 2, unit: "l", inventoryItemId: "milk" }], inventory),
    ).toEqual([{ inventoryItemId: "milk", name: "Mjölk", quantity: 2, unit: "l", estimatedPrice: 25 }]);
  });

  it("re-resolves by name when the saved link is gone or was never set", () => {
    const rows = resolveTemplateRows(
      [
        { name: "Milk", quantity: 1, unit: "l", inventoryItemId: "deleted-item" },
        { name: "sourdough bread", quantity: 1, unit: "", inventoryItemId: null },
      ],
      inventory,
    );
    expect(rows).toEqual([
      { inventoryItemId: "milk", name: "Milk", quantity: 1, unit: "l", estimatedPrice: 12.5 },
      { inventoryItemId: "bread", name: "sourdough bread", quantity: 1, unit: "pcs", estimatedPrice: undefined },
    ]);
  });

  it("never trusts a saved id that isn't in this household's inventory", () => {
    const [row] = resolveTemplateRows(
      [{ name: "Charcoal", quantity: 1, unit: "bag", inventoryItemId: "other-household-item" }],
      inventory,
    );
    expect(row).toEqual({ inventoryItemId: null, name: "Charcoal", quantity: 1, unit: "bag", estimatedPrice: undefined });
  });
});
