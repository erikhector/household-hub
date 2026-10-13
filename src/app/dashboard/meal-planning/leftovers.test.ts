// Pure tests for GAP-8's leftovers helpers — no mocks needed, same as
// cooked-ingredients.test.ts. The Prisma side (find-or-create/merge, undo)
// is covered through the Server Actions in cooking-actions.test.ts.
import { describe, expect, it } from "vitest";
import {
  LEFTOVERS_DAY_SEARCH_DAYS,
  LEFTOVERS_SHELF_LIFE_DAYS,
  leftoverServingsSchema,
  leftoversChangeSchema,
  leftoversExpiryUpdate,
  leftoversItemName,
  nextFreeDinnerDay,
} from "@/app/dashboard/meal-planning/leftovers";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-25T10:00:00.000Z");

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

describe("leftoversItemName", () => {
  it("prefixes the recipe name", () => {
    expect(leftoversItemName("Leftovers", " Lasagna ")).toBe("Leftovers: Lasagna");
    expect(leftoversItemName("Rester", "Lasagne")).toBe("Rester: Lasagne");
  });

  it("truncates a very long recipe name to fit the 120-character item name limit", () => {
    const name = leftoversItemName("Leftovers", "x".repeat(300));
    expect(name).toHaveLength(120);
    expect(name.startsWith("Leftovers: ")).toBe(true);
  });
});

describe("leftoversExpiryUpdate", () => {
  it("estimates 3 days out for a fresh item", () => {
    const patch = leftoversExpiryUpdate({ expiresAt: null, expiresAtEstimated: false, shelfLifeDays: null }, now);
    expect(patch).toEqual({
      expiresAt: new Date(now.getTime() + LEFTOVERS_SHELF_LIFE_DAYS * DAY_MS),
      expiresAtEstimated: true,
    });
  });

  it("resets an existing estimate to the fresh batch's date", () => {
    const patch = leftoversExpiryUpdate(
      { expiresAt: new Date("2026-09-20T00:00:00.000Z"), expiresAtEstimated: true, shelfLifeDays: null },
      now,
    );
    expect(patch?.expiresAt).toEqual(new Date(now.getTime() + 3 * DAY_MS));
  });

  it("honours a per-item shelf-life override", () => {
    const patch = leftoversExpiryUpdate({ expiresAt: null, expiresAtEstimated: false, shelfLifeDays: 5 }, now);
    expect(patch?.expiresAt).toEqual(new Date(now.getTime() + 5 * DAY_MS));
  });

  it("never overwrites a real date or a 'never expires' item", () => {
    expect(
      leftoversExpiryUpdate(
        { expiresAt: new Date("2026-10-01T00:00:00.000Z"), expiresAtEstimated: false, shelfLifeDays: null },
        now,
      ),
    ).toBeNull();
    expect(leftoversExpiryUpdate({ expiresAt: null, expiresAtEstimated: false, shelfLifeDays: -1 }, now)).toBeNull();
  });
});

describe("leftoversChangeSchema", () => {
  it("accepts both change shapes", () => {
    expect(leftoversChangeSchema.safeParse({ itemId: "a", created: true }).success).toBe(true);
    expect(
      leftoversChangeSchema.safeParse({
        itemId: "a",
        created: false,
        previousQuantity: 2,
        previousExpiresAt: null,
        previousExpiresAtEstimated: false,
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed payload", () => {
    expect(leftoversChangeSchema.safeParse({ itemId: "", created: true }).success).toBe(false);
    expect(
      leftoversChangeSchema.safeParse({
        itemId: "a",
        created: false,
        previousQuantity: -1,
        previousExpiresAt: "not a date",
        previousExpiresAtEstimated: false,
      }).success,
    ).toBe(false);
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
