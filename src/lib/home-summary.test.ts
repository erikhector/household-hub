import { describe, expect, it } from "vitest";
import { pickTargetList, pickUseSoon, summarizePantry } from "@/lib/home-summary";

describe("summarizePantry", () => {
  it("splits out from low, counts what is already on a list and what Add N would add", () => {
    const items = [
      { id: "salt", quantity: 0, lowStockThreshold: 1 },
      { id: "flour", quantity: 1, lowStockThreshold: 2 },
      { id: "rice", quantity: 1, lowStockThreshold: 3 },
      { id: "oil", quantity: 5, lowStockThreshold: 1 },
    ];
    expect(summarizePantry(items, new Set(["flour", "oil", null]))).toEqual({
      outCount: 1,
      lowCount: 2,
      onListCount: 1,
      toAddCount: 2,
    });
  });

  it("is all zeros for a stocked pantry", () => {
    expect(summarizePantry([{ id: "a", quantity: 3, lowStockThreshold: 3 }], new Set())).toEqual({
      outCount: 0,
      lowCount: 0,
      onListCount: 0,
      toAddCount: 0,
    });
  });
});

describe("pickTargetList", () => {
  const at = (iso: string) => new Date(iso);

  it("prefers the default list over a newer one", () => {
    const lists = [
      { id: "default", isDefault: true, createdAt: at("2026-01-01") },
      { id: "newer", isDefault: false, createdAt: at("2026-06-01") },
    ];
    expect(pickTargetList(lists)?.id).toBe("default");
  });

  it("falls back to the newest list, and to null with none", () => {
    const lists = [
      { id: "old", isDefault: false, createdAt: at("2026-01-01") },
      { id: "new", isDefault: false, createdAt: at("2026-06-01") },
    ];
    expect(pickTargetList(lists)?.id).toBe("new");
    expect(pickTargetList([])).toBeNull();
  });
});

describe("pickUseSoon", () => {
  // 31 Oct 2026, 23:30 UTC: already 00:30 on 1 Nov in Stockholm (UTC+1).
  const now = new Date("2026-10-31T23:30:00Z");
  const hours = (h: number) => new Date(now.getTime() + h * 60 * 60 * 1000);

  it("lists in-stock items inside the warning window, soonest first, with the day in the user's zone", () => {
    const items = [
      { id: "yoghurt", name: "Yoghurt", quantity: 1, expiresAt: hours(55) },
      { id: "milk", name: "Milk", quantity: 1, expiresAt: hours(30) },
      { id: "ham", name: "Ham", quantity: 1, expiresAt: hours(-2) },
      { id: "empty", name: "Empty", quantity: 0, expiresAt: hours(5) },
      { id: "rice", name: "Rice", quantity: 1, expiresAt: hours(24 * 300) },
      { id: "salt", name: "Salt", quantity: 1, expiresAt: null },
    ];
    const { shown, moreCount } = pickUseSoon(items, now, "Europe/Stockholm", 5);
    expect(shown.map((i) => [i.id, i.day])).toEqual([
      ["ham", "expired"],
      ["milk", "tomorrow"],
      ["yoghurt", "later"],
    ]);
    expect(moreCount).toBe(0);
    // An hour from now is 1 Nov: tomorrow in UTC, still today in Stockholm.
    expect(pickUseSoon([{ id: "a", name: "A", quantity: 1, expiresAt: hours(1) }], now, "UTC", 5).shown[0].day).toBe(
      "tomorrow",
    );
    expect(
      pickUseSoon([{ id: "a", name: "A", quantity: 1, expiresAt: hours(1) }], now, "Europe/Stockholm", 5).shown[0].day,
    ).toBe("today");
  });

  it("caps the chips and counts the rest", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: `i${i}`,
      name: `Item ${i}`,
      quantity: 1,
      expiresAt: hours(i + 1),
    }));
    const { shown, moreCount } = pickUseSoon(items, now, "UTC", 5);
    expect(shown).toHaveLength(5);
    expect(moreCount).toBe(2);
  });
});
