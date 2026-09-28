import { describe, expect, it } from "vitest";
import { MATCH_AUTO_ACCEPT_MIN_SCORE, MATCH_PRESELECT_MIN_SCORE } from "@/lib/item-matching";
import { isAutoAccepted, matchReceiptLine, matchReceiptLines } from "./receipt-match";

// A real EAN-13 with a valid check digit, and the same code with a broken one.
const EAN = "4006381333931";
const BAD_EAN = "4006381333932";

const candidates = [
  { id: "milk", name: "Mellanmjölk", barcode: EAN },
  { id: "tomatoes", name: "Tomatoes", barcode: null },
  { id: "bread", name: "Bread" },
];

describe("thresholds", () => {
  it("keeps the auto-accept bar stricter than the pre-select bar", () => {
    expect(MATCH_AUTO_ACCEPT_MIN_SCORE).toBeGreaterThan(MATCH_PRESELECT_MIN_SCORE);
  });
});

describe("matchReceiptLine", () => {
  it("auto-accepts an exact (normalized) name match", () => {
    expect(matchReceiptLine({ name: "BREAD" }, candidates)).toEqual({ matchId: "bread", confidence: "confident" });
  });

  it("pre-selects but doesn't auto-accept a near-miss", () => {
    // "tomato" vs "Tomatoes" is ~0.83 — above pre-select, below auto-accept.
    expect(matchReceiptLine({ name: "tomato" }, candidates)).toEqual({ matchId: "tomatoes", confidence: "suggested" });
  });

  it("returns no match below the pre-select threshold", () => {
    expect(matchReceiptLine({ name: "Dishwasher tabs" }, candidates)).toEqual({ matchId: null, confidence: "none" });
  });

  it("auto-accepts a barcode match even when the receipt name is abbreviated beyond recognition", () => {
    expect(matchReceiptLine({ name: "MJLK 1,5% 1L", barcode: EAN }, candidates)).toEqual({
      matchId: "milk",
      confidence: "barcode",
    });
  });

  it("normalizes a 12-digit UPC-A before comparing to the stored GTIN-13", () => {
    const upcCandidates = [{ id: "cola", name: "Cola", barcode: "0036000291452" }];
    expect(matchReceiptLine({ name: "X", barcode: "036000291452" }, upcCandidates)).toEqual({
      matchId: "cola",
      confidence: "barcode",
    });
  });

  it("ignores a barcode with a bad check digit and falls back to the name", () => {
    expect(matchReceiptLine({ name: "Bread", barcode: BAD_EAN }, [{ id: "bread", name: "Bread", barcode: BAD_EAN }])).toEqual(
      { matchId: "bread", confidence: "confident" },
    );
    expect(matchReceiptLine({ name: "Something else", barcode: BAD_EAN }, candidates).confidence).toBe("none");
  });

  it("falls back to name matching when no candidate has the line's barcode", () => {
    expect(matchReceiptLine({ name: "Bread", barcode: "96385074" }, candidates)).toEqual({
      matchId: "bread",
      confidence: "confident",
    });
  });

  it("leaves a barcode shared by two candidates open for review", () => {
    const dupes = [
      { id: "a", name: "Milk", barcode: EAN },
      { id: "b", name: "Milk", barcode: EAN },
    ];
    expect(matchReceiptLine({ name: "Milk", barcode: EAN }, dupes)).toEqual({ matchId: "a", confidence: "suggested" });
  });

  it("doesn't auto-accept when a second candidate is nearly as good", () => {
    const dupes = [
      { id: "a", name: "Mjölk" },
      { id: "b", name: "mjölk." },
    ];
    expect(matchReceiptLine({ name: "Mjölk" }, dupes).confidence).toBe("suggested");
  });

  it("auto-accepts when the runner-up is clearly worse", () => {
    const options = [
      { id: "a", name: "Mjölk" },
      { id: "b", name: "Mjölk laktosfri" },
    ];
    expect(matchReceiptLine({ name: "Mjölk" }, options)).toEqual({ matchId: "a", confidence: "confident" });
  });

  it("returns no match against an empty candidate list", () => {
    expect(matchReceiptLine({ name: "Bread", barcode: EAN }, [])).toEqual({ matchId: null, confidence: "none" });
  });
});

describe("matchReceiptLines", () => {
  const lines = [{ name: "Bread" }, { name: "bread" }, { name: "tomato" }];

  it("lets two lines accept the same candidate when not exclusive", () => {
    const matches = matchReceiptLines(lines, candidates);
    expect(matches.map((m) => m.confidence)).toEqual(["confident", "confident", "suggested"]);
  });

  it("demotes lines that would auto-accept the same candidate when exclusive", () => {
    const matches = matchReceiptLines(lines, candidates, { exclusive: true });
    expect(matches).toEqual([
      { matchId: "bread", confidence: "suggested" },
      { matchId: "bread", confidence: "suggested" },
      { matchId: "tomatoes", confidence: "suggested" },
    ]);
  });

  it("keeps a lone auto-accept when exclusive", () => {
    const matches = matchReceiptLines([{ name: "Bread" }, { name: "tomato" }], candidates, { exclusive: true });
    expect(matches.map(isAutoAccepted)).toEqual([true, false]);
  });
});

describe("learned aliases (MATCH-5)", () => {
  // Inventory items (RegisterReceiptDialog): the candidate's own id is the item.
  const items = [
    { id: "egg", name: "Egg" },
    { id: "milk", name: "Mellanmjölk" },
  ];
  const aliases = [
    { normalizedName: "ägg 12p", inventoryItemId: "egg" },
    { normalizedName: "mjolk", inventoryItemId: "milk" },
    { normalizedName: "vatten", inventoryItemId: null },
  ];

  it("auto-accepts a line through the household's alias", () => {
    // Without the alias, "ÄGG 12P" is nowhere near "Egg".
    expect(matchReceiptLines([{ name: "ÄGG 12P" }], items)[0].confidence).toBe("none");
    expect(matchReceiptLines([{ name: "ÄGG 12P" }], items, { aliases })).toEqual([
      { matchId: "egg", confidence: "confident" },
    ]);
  });

  it("ignores an untracked alias", () => {
    const [match] = matchReceiptLines([{ name: "Vatten" }], items, { aliases });
    expect(match.confidence).toBe("none");
  });

  it("lets a candidate named exactly like the line win over the alias", () => {
    const withMjolk = [...items, { id: "other", name: "Mjolk" }];
    expect(matchReceiptLines([{ name: "MJOLK" }], withMjolk, { aliases })[0].matchId).toBe("other");
  });

  it("matches list rows by their linked item, and leaves two rows for it open", () => {
    // Shopping-list rows (ReceiptScanDialog): matched through inventoryItemId.
    const rows = [
      { id: "row-1", name: "eggs", inventoryItemId: "egg" },
      { id: "row-2", name: "Mjölk", inventoryItemId: "milk" },
      { id: "row-3", name: "Mjölk (extra)", inventoryItemId: "milk" },
      { id: "row-4", name: "Something", inventoryItemId: null },
    ];
    expect(matchReceiptLines([{ name: "Ägg 12p" }, { name: "mjolk" }], rows, { exclusive: true, aliases })).toEqual([
      { matchId: "row-1", confidence: "confident" },
      { matchId: "row-2", confidence: "suggested" },
    ]);
  });

  it("still demotes two lines claiming the same row when exclusive", () => {
    const rows = [{ id: "row-1", name: "Hen fruit", inventoryItemId: "egg" }];
    const matches = matchReceiptLines([{ name: "ÄGG 12P" }, { name: "Ägg 12p" }], rows, { exclusive: true, aliases });
    expect(matches.map((match) => match.confidence)).toEqual(["suggested", "suggested"]);
    expect(matches.every((match) => !isAutoAccepted(match))).toBe(true);
  });
});
