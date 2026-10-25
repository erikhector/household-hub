import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { buildSampleData } from "@/lib/sample-data";
import { toDateKey } from "@/app/dashboard/meal-planning/date-utils";

const content = en.dashboard.sampleData.content;

describe("buildSampleData", () => {
  const now = new Date("2026-10-21T10:00:00Z"); // a Wednesday
  const data = buildSampleData(content, now, "batch-1");

  it("tags every row of every seeded kind with the batch", () => {
    const rows = [
      ...data.inventory,
      data.list,
      ...data.list.items,
      ...data.recipes,
      ...data.dinners,
      ...data.tasks,
    ];
    expect(rows.length).toBeGreaterThan(15);
    for (const row of rows) expect(row.sample).toBe("batch-1");
  });

  it("seeds a small pantry, three recipes, a few tasks and a planned week", () => {
    expect(data.inventory).toHaveLength(6);
    expect(data.recipes).toHaveLength(3);
    expect(data.tasks).toHaveLength(3);
    expect(data.dinners).toHaveLength(4);
  });

  it("points recipe ingredients and list items at pantry rows that exist", () => {
    const ids = new Set<string>(data.inventory.map((i) => i.id));
    for (const recipe of data.recipes) {
      for (const ing of recipe.ingredients) expect(ids.has(ing.inventoryItemId)).toBe(true);
    }
    for (const item of data.list.items) {
      if ("inventoryItemId" in item) expect(ids.has(item.inventoryItemId as string)).toBe(true);
    }
  });

  it("plans every dinner inside one Monday-start week, from today when four days fit", () => {
    expect(toDateKey(data.dinners[0].date)).toBe("2026-10-21");
    expect(toDateKey(data.weekStartDate)).toBe("2026-10-19");
    expect(data.dinners.every((d) => toDateKey(d.date) >= "2026-10-19" && toDateKey(d.date) <= "2026-10-25")).toBe(true);
  });

  it("moves the plan to next week when fewer than four days are left", () => {
    const friday = buildSampleData(content, new Date("2026-10-23T10:00:00Z"), "b");
    expect(toDateKey(friday.weekStartDate)).toBe("2026-10-26");
    expect(toDateKey(friday.dinners[3].date)).toBe("2026-10-29");
  });

  it("makes a fresh batch id per seed", () => {
    expect(buildSampleData(content, now).sample).not.toBe(buildSampleData(content, now).sample);
  });

  it("has Swedish copy for every key", () => {
    expect(Object.keys(sv.dashboard.sampleData.content).sort()).toEqual(Object.keys(content).sort());
  });
});
