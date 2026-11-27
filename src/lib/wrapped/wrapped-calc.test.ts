import { describe, expect, it } from "vitest";
import {
  computeWrapped,
  pickPersona,
  wrappedRange,
  WRAPPED_MIN_ACTIVITY,
  type WrappedInput,
  type WrappedRows,
} from "@/lib/wrapped/wrapped-calc";

const NOW = new Date("2026-11-27T12:00:00Z");

function empty(): WrappedRows {
  return {
    completedLists: [],
    boughtItems: [],
    cookedMeals: [],
    stockEvents: [],
    completedTasks: [],
    events: [],
    transactions: [],
  };
}

function input(rows: Partial<WrappedRows>, overrides: Partial<WrappedInput> = {}): WrappedInput {
  return { ...empty(), ...rows, year: 2026, timeZone: "UTC", now: NOW, ...overrides };
}

/** `n` tasks completed at noon UTC on consecutive days from `start`. */
function tasks(n: number, start = "2026-03-01"): { completedAt: Date }[] {
  const base = new Date(`${start}T12:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => ({ completedAt: new Date(base + i * 86_400_000) }));
}

function story(result: ReturnType<typeof computeWrapped>) {
  if (result.state !== "story") throw new Error(`expected a story, got ${result.state}`);
  return result;
}

describe("wrappedRange", () => {
  it("runs from 1 January to today while the year is on", () => {
    const range = wrappedRange(2026, NOW, "UTC");
    expect(range.since.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(range.until.toISOString()).toBe("2026-11-28T00:00:00.000Z");
    expect(range.firstDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(range.lastDate.toISOString()).toBe("2026-11-27T00:00:00.000Z");
  });

  it("covers the whole year once it is over", () => {
    const range = wrappedRange(2026, new Date("2027-01-10T12:00:00Z"), "UTC");
    expect(range.until.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(range.lastDate.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("starts at local midnight in the viewer's zone", () => {
    const range = wrappedRange(2026, NOW, "Europe/Stockholm");
    expect(range.since.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });
});

describe("computeWrapped thin data", () => {
  it("is thin with no activity at all", () => {
    expect(computeWrapped(input({}))).toEqual({ state: "thin", year: 2026 });
  });

  it("is thin just under the activity threshold", () => {
    expect(computeWrapped(input({ completedTasks: tasks(WRAPPED_MIN_ACTIVITY - 1) })).state).toBe("thin");
  });

  it("is a story at the threshold", () => {
    expect(computeWrapped(input({ completedTasks: tasks(WRAPPED_MIN_ACTIVITY) })).state).toBe("story");
  });

  it("is thin when everything happened on one or two days", () => {
    const sameDay = Array.from({ length: 20 }, () => ({ completedAt: new Date("2026-03-01T12:00:00Z") }));
    expect(computeWrapped(input({ completedTasks: sameDay })).state).toBe("thin");
  });

  it("doesn't let transactions alone lift a household out of thin", () => {
    const transactions = Array.from({ length: 50 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)) }));
    expect(computeWrapped(input({ transactions })).state).toBe("thin");
  });
});

describe("computeWrapped counts", () => {
  it("only counts what happened in the year so far", () => {
    const rows = {
      completedTasks: [
        ...tasks(10),
        { completedAt: new Date("2025-12-31T12:00:00Z") },
        { completedAt: new Date("2026-12-01T12:00:00Z") }, // after "now"
      ],
    };
    expect(story(computeWrapped(input(rows))).stats.tasks.completed).toBe(10);
  });

  it("reads instants on the viewer's clock", () => {
    // 23:30 UTC on 31 Dec 2025 is already 2026 in Stockholm.
    const edge = { completedAt: new Date("2025-12-31T23:30:00Z") };
    const rows = { completedTasks: [...tasks(10), edge] };
    expect(story(computeWrapped(input(rows, { timeZone: "Europe/Stockholm" }))).stats.tasks.completed).toBe(11);
    expect(story(computeWrapped(input(rows, { timeZone: "UTC" }))).stats.tasks.completed).toBe(10);
  });

  it("counts shopping: lists completed, items bought by tick or put-away, and the most bought", () => {
    const at = new Date("2026-05-02T10:00:00Z");
    const result = story(
      computeWrapped(
        input({
          completedTasks: tasks(10),
          completedLists: [{ completedAt: at }, { completedAt: new Date("2025-06-01T10:00:00Z") }],
          boughtItems: [
            { name: "Milk", checkedOffAt: at, putAwayAt: null },
            { name: "milk ", checkedOffAt: null, putAwayAt: at },
            { name: "Milk", checkedOffAt: at, putAwayAt: at },
            { name: "Bread", checkedOffAt: at, putAwayAt: null },
            { name: "Eggs", checkedOffAt: null, putAwayAt: null }, // never bought
          ],
        }),
      ),
    );
    expect(result.stats.shopping).toEqual({ listsCompleted: 1, itemsBought: 4, topItem: { name: "Milk", count: 3 } });
  });

  it("names no most-bought item when nothing repeats", () => {
    const at = new Date("2026-05-02T10:00:00Z");
    const result = story(
      computeWrapped(
        input({
          completedTasks: tasks(10),
          boughtItems: [
            { name: "Milk", checkedOffAt: at, putAwayAt: null },
            { name: "Bread", checkedOffAt: at, putAwayAt: null },
          ],
        }),
      ),
    );
    expect(result.stats.shopping.topItem).toBeNull();
  });

  it("breaks a most-bought tie alphabetically, whatever the row order", () => {
    const at = new Date("2026-05-02T10:00:00Z");
    const names = ["Milk", "Bread", "Milk", "Bread"];
    const rows = (order: string[]) => ({
      completedTasks: tasks(10),
      boughtItems: order.map((name) => ({ name, checkedOffAt: at, putAwayAt: null })),
    });
    expect(story(computeWrapped(input(rows(names)))).stats.shopping.topItem).toEqual({ name: "Bread", count: 2 });
    expect(story(computeWrapped(input(rows([...names].reverse())))).stats.shopping.topItem).toEqual({
      name: "Bread",
      count: 2,
    });
  });

  it("counts cooked meals and names the most cooked recipe by id", () => {
    const at = new Date("2026-04-10T18:00:00Z");
    const result = story(
      computeWrapped(
        input({
          completedTasks: tasks(10),
          cookedMeals: [
            { consumedAt: at, recipeId: "r1", recipeName: "Lasagna" },
            { consumedAt: at, recipeId: "r1", recipeName: "Lasagna" },
            { consumedAt: at, recipeId: "r2", recipeName: "Soup" },
            { consumedAt: at, recipeId: null, recipeName: null }, // recipe since deleted
            { consumedAt: new Date("2025-04-10T18:00:00Z"), recipeId: "r2", recipeName: "Soup" },
          ],
        }),
      ),
    );
    expect(result.stats.meals).toEqual({ cooked: 4, topRecipe: { name: "Lasagna", count: 2 } });
  });

  it("keeps two recipes with the same name apart", () => {
    const at = new Date("2026-04-10T18:00:00Z");
    const result = story(
      computeWrapped(
        input({
          completedTasks: tasks(10),
          cookedMeals: [
            { consumedAt: at, recipeId: "r1", recipeName: "Soup" },
            { consumedAt: at, recipeId: "r2", recipeName: "Soup" },
          ],
        }),
      ),
    );
    expect(result.stats.meals.topRecipe).toBeNull();
  });

  it("counts pantry restocks (taps and trips) but not uses or adjustments", () => {
    const at = new Date("2026-02-10T09:00:00Z");
    const result = story(
      computeWrapped(
        input({
          completedTasks: tasks(10),
          stockEvents: [
            { reason: "restocked", delta: 1, createdAt: at, itemName: "Coffee" },
            { reason: "trip", delta: 2, createdAt: at, itemName: "Coffee" },
            { reason: "restocked", delta: 1, createdAt: at, itemName: "Rice" },
            { reason: "used", delta: -1, createdAt: at, itemName: "Coffee" },
            { reason: "adjusted", delta: 3, createdAt: at, itemName: "Coffee" },
            { reason: "cooked", delta: -1, createdAt: at, itemName: "Rice" },
          ],
        }),
      ),
    );
    expect(result.stats.pantry).toEqual({ restocks: 3, topRestocked: { name: "Coffee", count: 2 } });
    // The trip is already an item bought, so only the two hand restocks add to activity.
    expect(result.stats.activity.total).toBe(12);
  });

  it("counts every calendar day an event fell on, up to today", () => {
    const result = story(
      computeWrapped(
        input({
          completedTasks: tasks(10),
          events: [
            { date: new Date("2026-03-15T00:00:00Z"), recurrence: null },
            { date: new Date("2025-06-01T00:00:00Z"), recurrence: "YEARLY" }, // 1 June 2026
            { date: new Date("2026-11-01T00:00:00Z"), recurrence: "WEEKLY" }, // 1, 8, 15, 22 Nov
            { date: new Date("2026-12-24T00:00:00Z"), recurrence: null }, // after today
            { date: new Date("2025-03-15T00:00:00Z"), recurrence: null }, // last year
          ],
        }),
      ),
    );
    expect(result.stats.calendar.events).toBe(6);
  });

  it("counts transactions by calendar day, as a neutral number", () => {
    const result = story(
      computeWrapped(
        input({
          completedTasks: tasks(10),
          transactions: [
            { date: new Date("2026-01-01T00:00:00Z") },
            { date: new Date("2026-11-27T00:00:00Z") },
            { date: new Date("2026-11-28T00:00:00Z") }, // future-dated
            { date: new Date("2025-12-31T00:00:00Z") },
          ],
        }),
      ),
    );
    expect(result.stats.money.transactions).toBe(2);
    expect(result.stats.activity.total).toBe(10);
  });

  it("finds the busiest month and the active days, ties going to the earlier month", () => {
    const result = story(
      computeWrapped(input({ completedTasks: [...tasks(5, "2026-02-01"), ...tasks(5, "2026-07-01"), ...tasks(1, "2026-02-01")] })),
    );
    expect(result.stats.activity).toEqual({ total: 11, activeDays: 10, busiestMonth: 1 });

    const tie = story(computeWrapped(input({ completedTasks: [...tasks(5, "2026-07-01"), ...tasks(5, "2026-02-10")] })));
    expect(tie.stats.activity.busiestMonth).toBe(1);
  });
});

describe("computeWrapped cards", () => {
  it("skips the cards with nothing to say", () => {
    const result = story(computeWrapped(input({ completedTasks: tasks(10) })));
    expect(result.cards.map((c) => c.kind)).toEqual(["intro", "tasks", "busiest", "persona"]);
  });

  it("tells the whole story when every feature was used, money last before the persona", () => {
    const at = new Date("2026-05-02T10:00:00Z");
    const result = story(
      computeWrapped(
        input({
          completedTasks: tasks(10),
          completedLists: [{ completedAt: at }],
          cookedMeals: [{ consumedAt: at, recipeId: "r1", recipeName: "Soup" }],
          stockEvents: [{ reason: "restocked", delta: 1, createdAt: at, itemName: "Rice" }],
          events: [{ date: new Date("2026-05-02T00:00:00Z"), recurrence: null }],
          transactions: [{ date: new Date("2026-05-02T00:00:00Z") }],
        }),
      ),
    );
    expect(result.cards.map((c) => c.kind)).toEqual([
      "intro",
      "shopping",
      "meals",
      "pantry",
      "tasks",
      "calendar",
      "busiest",
      "money",
      "persona",
    ]);
  });
});

describe("pickPersona", () => {
  const zero = {
    shopping: { listsCompleted: 0, itemsBought: 0, topItem: null },
    meals: { cooked: 0, topRecipe: null },
    pantry: { restocks: 0, topRestocked: null },
    tasks: { completed: 0 },
    calendar: { events: 0 },
  };

  it("picks the feature with the most weighted activity", () => {
    expect(pickPersona({ ...zero, meals: { cooked: 10, topRecipe: null } })).toBe("chef");
    expect(pickPersona({ ...zero, shopping: { listsCompleted: 5, itemsBought: 100, topItem: null } })).toBe("forager");
    expect(pickPersona({ ...zero, pantry: { restocks: 30, topRestocked: null } })).toBe("stocker");
    expect(pickPersona({ ...zero, tasks: { completed: 20 }, calendar: { events: 5 } })).toBe("planner");
  });

  it("weights a cooked meal above an item bought", () => {
    // 10 meals (40) beat 35 items bought.
    expect(
      pickPersona({ ...zero, meals: { cooked: 10, topRecipe: null }, shopping: { listsCompleted: 0, itemsBought: 35, topItem: null } }),
    ).toBe("chef");
  });

  it("settles a tie in a fixed order", () => {
    // planner 20, chef 20: planner comes first.
    expect(pickPersona({ ...zero, tasks: { completed: 10 }, meals: { cooked: 5, topRecipe: null } })).toBe("planner");
    expect(pickPersona(zero)).toBe("planner");
  });
});
