// Pure tests for GAP-8's leftovers helpers — no mocks needed, same as
// cooked-ingredients.test.ts. The Prisma side (the leftovers batch and its
// undo) is covered through the Server Actions in cooking-actions.test.ts.
import { describe, expect, it } from "vitest";
import {
  LEFTOVERS_DAY_SEARCH_DAYS,
  leftoverServingsSchema,
  leftoversChangeSchema,
  nextFreeDinnerDay,
} from "@/app/dashboard/meal-planning/leftovers";

describe("leftoverServingsSchema", () => {
  it("treats blank/missing as 0 (no leftovers)", () => {
    expect(leftoverServingsSchema.parse(null)).toBe(0);
    expect(leftoverServingsSchema.parse("")).toBe(0);
    expect(leftoverServingsSchema.parse("  ")).toBe(0);
  });

  it("accepts whole numbers from 0 to 100", () => {
    expect(leftoverServingsSchema.parse("0")).toBe(0);
    expect(leftoverServingsSchema.parse("3")).toBe(3);
    expect(leftoverServingsSchema.parse("100")).toBe(100);
  });

  it("rejects negatives, fractions, junk and absurd values", () => {
    for (const value of ["-1", "1.5", "abc", "101"]) {
      expect(leftoverServingsSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("leftoversChangeSchema", () => {
  it("accepts a batch id", () => {
    expect(leftoversChangeSchema.safeParse({ batchId: "batch-1" }).success).toBe(true);
  });

  it("rejects a malformed payload, including the old inventory-row shape", () => {
    expect(leftoversChangeSchema.safeParse({ batchId: "" }).success).toBe(false);
    expect(leftoversChangeSchema.safeParse({ batchId: 7 }).success).toBe(false);
    expect(leftoversChangeSchema.safeParse({ itemId: "a", created: true }).success).toBe(false);
  });
});

describe("nextFreeDinnerDay", () => {
  it("suggests the day after the cook when it has no dinner", () => {
    expect(nextFreeDinnerDay("2026-01-05", [])).toBe("2026-01-06");
  });

  it("skips days that already have a dinner", () => {
    expect(nextFreeDinnerDay("2026-01-05", ["2026-01-06", "2026-01-07"])).toBe("2026-01-08");
  });

  it("only skips taken days, so a free day after a gap is used", () => {
    expect(nextFreeDinnerDay("2026-01-05", ["2026-01-07"])).toBe("2026-01-06");
  });

  it("ignores a dinner on the cook day itself and crosses month and year ends", () => {
    expect(nextFreeDinnerDay("2026-12-30", ["2026-12-30", "2026-12-31"])).toBe("2027-01-01");
  });

  it("returns the day past the search window when every day in it is taken", () => {
    const taken = Array.from({ length: LEFTOVERS_DAY_SEARCH_DAYS }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 6 + i));
      return d.toISOString().slice(0, 10);
    });
    expect(nextFreeDinnerDay("2026-01-05", taken)).toBe("2026-03-07");
  });
});
