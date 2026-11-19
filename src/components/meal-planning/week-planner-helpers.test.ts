import { beforeEach, describe, expect, it, vi } from "vitest";

const { toast, copyWeekAction, undoCopyWeekAction } = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast, copyWeekAction: vi.fn(), undoCopyWeekAction: vi.fn() };
});

vi.mock("sonner", () => ({ toast }));
vi.mock("@/app/dashboard/meal-planning/planner-actions", () => ({ copyWeekAction, undoCopyWeekAction }));

import { en } from "@/lib/i18n/dictionaries/en";
import { parseDateKey } from "@/app/dashboard/meal-planning/date-utils";
import type { MealPlanEntryData } from "@/components/meal-planning/types";
import { buildWeek, copyLastWeek, daySlots, formatWeekRange } from "./week-planner-helpers";

const dict = en.mealPlanning;

function entry(id: string, date: string, mealType: MealPlanEntryData["mealType"], recipeId: string | null = null) {
  return {
    id,
    date,
    mealType,
    recipeId,
    recipeName: recipeId ? `Recipe ${recipeId}` : null,
    freeformName: recipeId ? null : `Meal ${id}`,
    freeformIngredients: null,
    note: null,
    portions: 2,
    consumedAt: null,
    preparedBatchId: null,
  } satisfies MealPlanEntryData;
}

// Runs the transition callback at once, as React would schedule it.
const run = (callback: () => Promise<void>) => void callback();

describe("copyLastWeek", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("copies the previous week into this one and offers an Undo of exactly those entries", async () => {
    copyWeekAction.mockResolvedValue({ entryIds: ["a", "b"] });
    undoCopyWeekAction.mockResolvedValue({});
    copyLastWeek(dict, "2031-03-10", "2031-03-03", run);
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(copyWeekAction).toHaveBeenCalledWith("2031-03-03", "2031-03-10");
    const [message, options] = toast.success.mock.calls[0];
    expect(message).toBe("Copied 2 meals from last week");
    options.action.onClick();
    expect(undoCopyWeekAction).toHaveBeenCalledWith(["a", "b"]);
    await vi.waitFor(() => expect(toast.success).toHaveBeenLastCalledWith(dict.copyLastWeekUndoneToast));
  });

  it("says so when last week had nothing to copy", async () => {
    copyWeekAction.mockResolvedValue({ entryIds: [] });
    copyLastWeek(dict, "2031-03-10", "2031-03-03", run);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(dict.copyLastWeekNothingToast));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows the action's error and offers no Undo", async () => {
    copyWeekAction.mockResolvedValue({ error: "Nope" });
    copyLastWeek(dict, "2031-03-10", "2031-03-03", run);
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows the Undo's own error when the copy can't be taken back", async () => {
    copyWeekAction.mockResolvedValue({ entryIds: ["a"] });
    undoCopyWeekAction.mockResolvedValue({ error: "Too late" });
    copyLastWeek(dict, "2031-03-10", "2031-03-03", run);
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    toast.success.mock.calls[0][1].action.onClick();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Too late"));
  });
});

describe("formatWeekRange", () => {
  it("names the week in UTC with plain spaces around the dash", () => {
    const range = formatWeekRange("en", parseDateKey("2031-03-10"));
    expect(range).toMatch(/^Mar 10 – 16, 2031$/);
    expect(range).not.toMatch(/[\u2009\u202f]/);
  });

  it("spans two months and drops the repeated year", () => {
    expect(formatWeekRange("en", parseDateKey("2031-03-31"))).toBe("Mar 31 – Apr 6, 2031");
  });
});

describe("buildWeek", () => {
  const weekStart = parseDateKey("2031-03-10"); // a Monday

  it("lists Monday to Sunday with labels and marks today", () => {
    const { days } = buildWeek(dict, weekStart, "2031-03-12", []);
    expect(days.map((day) => day.label)).toEqual(["Mon 10", "Tue 11", "Wed 12", "Thu 13", "Fri 14", "Sat 15", "Sun 16"]);
    expect(days.filter((day) => day.isToday).map((day) => day.dateKey)).toEqual(["2031-03-12"]);
  });

  it("offers only days from today on as empty days and free dinners", () => {
    const entries = [
      entry("1", "2031-03-10", "DINNER", "r1"),
      entry("2", "2031-03-13", "LUNCH", "r2"),
      entry("3", "2031-03-14", "DINNER", "r1"),
    ];
    const week = buildWeek(dict, weekStart, "2031-03-12", entries);
    // Thursday has a lunch, so it isn't empty, but its dinner is still free.
    expect(week.emptyDays.map((day) => day.dateKey)).toEqual(["2031-03-12", "2031-03-15", "2031-03-16"]);
    expect(week.freeDinners).toEqual([
      { weekday: 2, dateKey: "2031-03-12", label: "Wed 12" },
      { weekday: 3, dateKey: "2031-03-13", label: "Thu 13" },
      { weekday: 5, dateKey: "2031-03-15", label: "Sat 15" },
      { weekday: 6, dateKey: "2031-03-16", label: "Sun 16" },
    ]);
    expect(week.plannedRecipeIds).toEqual(["r1", "r2"]);
    expect(week.entriesByDay.get("2031-03-14")?.map((e) => e.id)).toEqual(["3"]);
    expect(week.placeDays.find((day) => day.dateKey === "2031-03-13")?.entries.map((e) => e.id)).toEqual(["2"]);
    expect(week.placeDays).toHaveLength(7);
  });

  it("puts the first dinner on today, or on Monday of a week that's over", () => {
    expect(buildWeek(dict, weekStart, "2031-03-12", []).firstOpenDay.dateKey).toBe("2031-03-12");
    expect(buildWeek(dict, weekStart, "2031-03-01", []).firstOpenDay.dateKey).toBe("2031-03-10");
    expect(buildWeek(dict, weekStart, "2031-04-01", []).firstOpenDay.dateKey).toBe("2031-03-10");
  });
});

describe("daySlots", () => {
  it("sorts a day's meals breakfast to snack", () => {
    const { sorted } = daySlots([entry("s", "d", "SNACK"), entry("d", "d", "DINNER"), entry("b", "d", "BREAKFAST")]);
    expect(sorted.map((e) => e.id)).toEqual(["b", "d", "s"]);
  });

  it("asks for dinner until it's planned, then the first free slot", () => {
    expect(daySlots([]).openSlot).toBe("DINNER");
    expect(daySlots([entry("b", "d", "BREAKFAST")]).openSlot).toBe("DINNER");
    expect(daySlots([entry("d", "d", "DINNER")]).openSlot).toBe("BREAKFAST");
    expect(daySlots([entry("b", "d", "BREAKFAST"), entry("d", "d", "DINNER")]).openSlot).toBe("LUNCH");
  });

  it("falls back to dinner when every slot is taken", () => {
    const full = (["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const).map((type) => entry(type, "d", type));
    expect(daySlots(full).openSlot).toBe("DINNER");
  });

  it("does not reorder the day's own list", () => {
    const entries = [entry("d", "d", "DINNER"), entry("b", "d", "BREAKFAST")];
    daySlots(entries);
    expect(entries.map((e) => e.id)).toEqual(["d", "b"]);
  });
});
