import { describe, expect, it } from "vitest";
import { parseDateKey } from "@/app/dashboard/meal-planning/date-utils";
import {
  buildTemplateEntries,
  planTemplateRows,
  templateSlotKey,
} from "@/app/dashboard/meal-planning/plan-template-calc";

const monday = parseDateKey("2026-01-05");
const entry = (date: string, mealType: "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK", over = {}) => ({
  date: parseDateKey(date),
  mealType,
  recipeId: null as string | null,
  freeformName: "Soup" as string | null,
  portions: 2,
  ...over,
});

describe("buildTemplateEntries", () => {
  it("maps each date to its offset from the week's Monday, sorted by day", () => {
    const result = buildTemplateEntries(monday, [
      entry("2026-01-11", "DINNER"),
      entry("2026-01-05", "LUNCH"),
      entry("2026-01-07", "DINNER", { recipeId: "r1", freeformName: null }),
    ]);
    expect(result.map((e) => e.dayOffset)).toEqual([0, 2, 6]);
    expect(result[1]).toMatchObject({ recipeId: "r1", freeformName: null, mealType: "DINNER" });
  });

  it("drops entries outside the week and nameless ones", () => {
    const result = buildTemplateEntries(monday, [
      entry("2026-01-04", "DINNER"),
      entry("2026-01-12", "DINNER"),
      entry("2026-01-06", "DINNER", { freeformName: null }),
      entry("2026-01-06", "LUNCH"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].dayOffset).toBe(1);
  });
});

describe("planTemplateRows", () => {
  const nextMonday = parseDateKey("2026-02-02");
  const templateEntries = [
    { dayOffset: 0, mealType: "DINNER" as const, recipeId: "r1", freeformName: null, portions: 4 },
    { dayOffset: 2, mealType: "LUNCH" as const, recipeId: null, freeformName: "Soup", portions: 2 },
  ];

  it("stamps each offset onto the target week", () => {
    const rows = planTemplateRows(nextMonday, templateEntries, new Set(), new Set(["r1"]));
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-02-02", "2026-02-04"]);
    expect(rows[0]).toMatchObject({ recipeId: "r1", portions: 4 });
  });

  it("skips slots that are already filled and keeps the rest", () => {
    const filled = new Set([templateSlotKey(parseDateKey("2026-02-02"), "DINNER")]);
    const rows = planTemplateRows(nextMonday, templateEntries, filled, new Set(["r1"]));
    expect(rows).toHaveLength(1);
    expect(rows[0].freeformName).toBe("Soup");
  });

  it("drops a recipe entry whose recipe the household doesn't own", () => {
    const rows = planTemplateRows(nextMonday, templateEntries, new Set(), new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].freeformName).toBe("Soup");
  });
});
