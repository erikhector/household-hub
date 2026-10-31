import { describe, expect, it } from "vitest";
import { pickTargetList, pickUseSoon, summarizePantry } from "@/lib/home-summary";

describe("summarizePantry", () => {
  const none = { onAnyListIds: new Set<string>(), targetPendingIds: new Set<string>(), incomingByItem: new Map() };
  const items = [
    { id: "salt", quantity: 0, lowStockThreshold: 1 },
    { id: "flour", quantity: 1, lowStockThreshold: 2 },
    { id: "rice", quantity: 1, lowStockThreshold: 3 },
    { id: "oil", quantity: 5, lowStockThreshold: 1 },
  ];

  it("splits out from low and counts what is already on a list", () => {
    expect(summarizePantry(items, { ...none, onAnyListIds: new Set(["flour", "oil", null]) })).toEqual({
      outCount: 1,
      lowCount: 2,
      onListCount: 1,
      toAddCount: 3,
    });
  });

  it("with two lists, Add N skips only what the target list already has", () => {
    // Flour is on the other list, rice on the target: the action adds salt
    // and flour to the target, so N is 2, while both count as "on the list".
    const summary = summarizePantry(items, {
      ...none,
      onAnyListIds: new Set(["flour", "rice"]),
      targetPendingIds: new Set(["rice"]),
    });
    expect(summary.onListCount).toBe(2);
    expect(summary.toAddCount).toBe(2);
  });

  it("counts stock bought but not put away as covering the shortfall, like the action", () => {
    // Salt (0 + 1) and flour (1 + 2) are covered by what's on the counter;
    // rice (1 + 1) is still under its threshold of 3.
    const summary = summarizePantry(items, {
      ...none,
      incomingByItem: new Map([
        ["salt", 1],
        ["flour", 2],
        ["rice", 1],
      ]),
    });
    // The warning still reads the pantry as it is (the inventory filter's view).
    expect([summary.outCount, summary.lowCount]).toEqual([1, 2]);
    expect(summary.toAddCount).toBe(1);
    // Everything covered: no button at all.
    expect(
      summarizePantry(items, { ...none, incomingByItem: new Map([["salt", 1], ["flour", 2], ["rice", 2]]) })
        .toAddCount,
    ).toBe(0);
  });

  it("is all zeros for a stocked pantry", () => {
    expect(summarizePantry([{ id: "a", quantity: 3, lowStockThreshold: 3 }], none)).toEqual({
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
  // 31 Oct 2026, 23:30 UTC: 18:30 on 31 Oct in Bogotá (UTC−5, no DST) and
  // already 00:30 on 1 Nov in Stockholm (UTC+1).
  const now = new Date("2026-10-31T23:30:00Z");
  // A typed expiry date: a date with no time, stored as UTC midnight.
  const dateOnly = (key: string) => new Date(`${key}T00:00:00Z`);
  const item = (id: string, expiresAt: Date | null, quantity = 1) => ({ id, name: id, quantity, expiresAt });

  it("names a typed date by its own day, west of UTC (Bogotá)", () => {
    const { shown } = pickUseSoon(
      [item("nov1", dateOnly("2026-11-01")), item("oct31", dateOnly("2026-10-31")), item("oct30", dateOnly("2026-10-30"))],
      now,
      "America/Bogota",
      5,
    );
    // 1 Nov is tomorrow there, not "today" (its UTC midnight is 19:00 on
    // 31 Oct in Bogotá); today's own date is still today.
    expect(shown.map((i) => [i.id, i.day])).toEqual([
      ["oct30", "expired"],
      ["oct31", "today"],
      ["nov1", "tomorrow"],
    ]);
  });

  it("names a typed date by its own day, east of UTC (Stockholm)", () => {
    const { shown } = pickUseSoon(
      [
        item("nov3", dateOnly("2026-11-03")),
        item("nov2", dateOnly("2026-11-02")),
        item("nov1", dateOnly("2026-11-01")),
        item("oct31", dateOnly("2026-10-31")),
      ],
      now,
      "Europe/Stockholm",
      5,
    );
    expect(shown.map((i) => [i.id, i.day])).toEqual([
      ["oct31", "expired"],
      ["nov1", "today"],
      ["nov2", "tomorrow"],
      ["nov3", "later"],
    ]);
  });

  it("leaves out empty, far-off and undated items", () => {
    const { shown } = pickUseSoon(
      [item("empty", dateOnly("2026-11-01"), 0), item("rice", dateOnly("2027-06-01")), item("salt", null)],
      now,
      "UTC",
      5,
    );
    expect(shown).toEqual([]);
  });

  it("caps the chips and counts the rest", () => {
    const items = Array.from({ length: 7 }, (_, i) => item(`i${i}`, new Date(now.getTime() + (i + 1) * 3600_000)));
    const { shown, moreCount } = pickUseSoon(items, now, "UTC", 5);
    expect(shown).toHaveLength(5);
    expect(moreCount).toBe(2);
  });
});
