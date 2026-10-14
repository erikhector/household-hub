import { describe, expect, it } from "vitest";
import {
  assignPortionsSchema,
  defaultBatchExpiry,
  discardSnapshotSchema,
  isActiveBatch,
  portionsAfterReturn,
  prepUndoSchema,
  recordPrepSchema,
  totalRequested,
} from "@/app/dashboard/meal-planning/prepared-batch-calc";

const dish = (over: Record<string, unknown> = {}) => ({ recipeId: "r1", portions: 4, ...over });

describe("defaultBatchExpiry", () => {
  it("is three days after cooking", () => {
    expect(defaultBatchExpiry(new Date("2026-10-11T18:00:00Z")).toISOString()).toBe("2026-10-14T18:00:00.000Z");
  });
});

describe("portionsAfterReturn", () => {
  it("adds back", () => expect(portionsAfterReturn(3, 8, 2)).toBe(5));
  it("caps at total", () => expect(portionsAfterReturn(7, 8, 4)).toBe(8));
  it("ignores negatives", () => expect(portionsAfterReturn(3, 8, -2)).toBe(3));
});

describe("totalRequested", () => {
  it("sums portions", () => expect(totalRequested([{ portions: 2 }, { portions: 3 }])).toBe(5));
  it("is 0 for none", () => expect(totalRequested([])).toBe(0));
});

describe("isActiveBatch", () => {
  it("active with portions left", () => expect(isActiveBatch(1, 0)).toBe(true));
  it("active while planned", () => expect(isActiveBatch(0, 2)).toBe(true));
  it("inactive when empty and unplanned", () => expect(isActiveBatch(0, 0)).toBe(false));
});

describe("recordPrepSchema", () => {
  it("accepts 1–5 dishes", () => {
    expect(recordPrepSchema.safeParse([dish()]).success).toBe(true);
    expect(recordPrepSchema.safeParse(Array.from({ length: 5 }, () => dish())).success).toBe(true);
    expect(recordPrepSchema.safeParse(Array.from({ length: 6 }, () => dish())).success).toBe(false);
    expect(recordPrepSchema.safeParse([]).success).toBe(false);
  });
  it("rejects 0 and 101 portions, coerces strings", () => {
    expect(recordPrepSchema.safeParse([dish({ portions: 0 })]).success).toBe(false);
    expect(recordPrepSchema.safeParse([dish({ portions: 101 })]).success).toBe(false);
    expect(recordPrepSchema.safeParse([dish({ portions: 2.5 })]).success).toBe(false);
    const ok = recordPrepSchema.safeParse([dish({ portions: "6" })]);
    expect(ok.success && ok.data[0].portions).toBe(6);
  });
  it("rejects a malformed expiry date", () => {
    expect(recordPrepSchema.safeParse([dish({ expiryDate: "2026-02-31" })]).success).toBe(false);
    expect(recordPrepSchema.safeParse([dish({ expiryDate: "tomorrow" })]).success).toBe(false);
    expect(recordPrepSchema.safeParse([dish({ expiryDate: "2026-10-14" })]).success).toBe(true);
  });
  it("reports error keys, not prose", () => {
    const r = recordPrepSchema.safeParse([dish({ portions: 0 })]);
    expect(!r.success && r.error.issues[0].message).toBe("prepPortionsInvalid");
  });
});

describe("assignPortionsSchema", () => {
  const slot = (over: Record<string, unknown> = {}) => ({ date: "2026-10-15", mealType: "DINNER", portions: 2, ...over });
  it("accepts distinct slots", () => {
    expect(assignPortionsSchema.safeParse({ batchId: "b", slots: [slot(), slot({ mealType: "LUNCH" })] }).success).toBe(true);
  });
  it("rejects the same slot twice", () => {
    expect(assignPortionsSchema.safeParse({ batchId: "b", slots: [slot(), slot()] }).success).toBe(false);
  });
  it("rejects 0 portions", () => {
    expect(assignPortionsSchema.safeParse({ batchId: "b", slots: [slot({ portions: 0 })] }).success).toBe(false);
  });
  it("rejects empty and over-28 slot lists", () => {
    expect(assignPortionsSchema.safeParse({ batchId: "b", slots: [] }).success).toBe(false);
    const many = Array.from({ length: 29 }, (_, i) => slot({ date: `2026-11-${String((i % 28) + 1).padStart(2, "0")}`, mealType: i < 28 ? "DINNER" : "LUNCH" }));
    expect(assignPortionsSchema.safeParse({ batchId: "b", slots: many }).success).toBe(false);
  });
});

describe("prepUndoSchema / discardSnapshotSchema", () => {
  const undo = {
    batchIds: ["b1"],
    rows: [{ itemId: "i1", quantity: 2.5 }],
    autoAdded: [{ shoppingListItemId: "s1", listId: "l1", listName: "Groceries", itemName: "Milk" }],
  };
  const snapshot = {
    batch: {
      id: "b1",
      recipeId: "r1",
      cookedByMemberId: "m1",
      totalPortions: 8,
      remainingPortions: 3,
      cookedAt: "2026-10-11T18:00:00.000Z",
      expiryDate: "2026-10-14T18:00:00.000Z",
    },
    entries: [{ id: "e1", portions: 5, consumed: false }],
  };
  it("round-trips a valid payload", () => {
    expect(prepUndoSchema.parse(undo)).toEqual(undo);
    expect(discardSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(discardSnapshotSchema.safeParse({ ...snapshot, batch: { ...snapshot.batch, expiryDate: null } }).success).toBe(true);
    // A batch whose cook has left the household (cookedByMemberId SetNull).
    expect(discardSnapshotSchema.safeParse({ ...snapshot, batch: { ...snapshot.batch, cookedByMemberId: null } }).success).toBe(true);
  });
  it("requires each entry to say whether it was eaten", () => {
    expect(discardSnapshotSchema.safeParse({ ...snapshot, entries: [{ id: "e1", portions: 5 }] }).success).toBe(false);
  });
  it("rejects a non-ISO date", () => {
    expect(discardSnapshotSchema.safeParse({ ...snapshot, batch: { ...snapshot.batch, cookedAt: "yesterday" } }).success).toBe(false);
    expect(discardSnapshotSchema.safeParse({ ...snapshot, batch: { ...snapshot.batch, expiryDate: "2026-10-14" } }).success).toBe(false);
  });
  it("rejects remaining portions above the total", () => {
    const bad = { ...snapshot, batch: { ...snapshot.batch, totalPortions: 1, remainingPortions: 100 } };
    expect(discardSnapshotSchema.safeParse(bad).success).toBe(false);
  });
  it("bounds undo batches and quantities", () => {
    expect(prepUndoSchema.safeParse({ ...undo, batchIds: [] }).success).toBe(false);
    expect(prepUndoSchema.safeParse({ ...undo, batchIds: ["1", "2", "3", "4", "5", "6"] }).success).toBe(false);
    expect(prepUndoSchema.safeParse({ ...undo, rows: [{ itemId: "i", quantity: 1_000_001 }] }).success).toBe(false);
    expect(prepUndoSchema.safeParse({ ...undo, rows: [{ itemId: "i", quantity: 0 }] }).success).toBe(false);
  });
});
