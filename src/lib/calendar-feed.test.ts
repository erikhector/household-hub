import { describe, expect, it } from "vitest";
import {
  buildCalendarFeedEvents,
  calendarFeedPath,
  calendarFeedWindow,
  generateCalendarFeedToken,
  isWellFormedCalendarFeedToken,
  type CalendarFeedStrings,
  type FeedBill,
  type FeedMealEntry,
} from "@/lib/calendar-feed";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const strings: CalendarFeedStrings = {
  mealSummary: "{meal}: {name}",
  billSummary: "Due: {name}",
  mealTypes: { BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner", SNACK: "Snack" },
};

function meal(overrides: Partial<FeedMealEntry> & { id: string }): FeedMealEntry {
  return { date: utc(2026, 10, 1), mealType: "DINNER", recipeName: null, freeformName: null, ...overrides };
}

function bill(overrides: Partial<FeedBill> & { id: string }): FeedBill {
  return { name: "Rent", frequency: "MONTHLY", dayOfMonth: 25, ...overrides };
}

describe("calendar feed tokens", () => {
  it("generates 43-character base64url tokens (32 random bytes)", () => {
    const token = generateCalendarFeedToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("generates a different token every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateCalendarFeedToken));
    expect(tokens.size).toBe(50);
  });

  it("accepts only well-formed tokens", () => {
    expect(isWellFormedCalendarFeedToken(generateCalendarFeedToken())).toBe(true);
    expect(isWellFormedCalendarFeedToken("")).toBe(false);
    expect(isWellFormedCalendarFeedToken("a".repeat(42))).toBe(false);
    expect(isWellFormedCalendarFeedToken("a".repeat(44))).toBe(false);
    expect(isWellFormedCalendarFeedToken("a".repeat(42) + "=")).toBe(false);
    expect(isWellFormedCalendarFeedToken("a".repeat(42) + "/")).toBe(false);
    expect(isWellFormedCalendarFeedToken("a".repeat(42) + "+")).toBe(false);
  });

  it("puts the token in the path and the locale in the query", () => {
    expect(calendarFeedPath("tok", "sv")).toBe("/api/calendar/tok?lang=sv");
  });
});

describe("calendarFeedWindow", () => {
  it("spans 30 days back to 183 days ahead, as UTC midnights", () => {
    const { from, to } = calendarFeedWindow(new Date("2026-09-25T22:15:00Z"));
    expect(from.toISOString()).toBe("2026-08-26T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-03-27T00:00:00.000Z");
  });
});

describe("buildCalendarFeedEvents", () => {
  const from = utc(2026, 9, 1);
  const to = utc(2026, 11, 30);

  it("titles a meal with its slot and recipe name", () => {
    const events = buildCalendarFeedEvents({
      meals: [meal({ id: "m1", recipeName: "Lasagna" })],
      bills: [],
      from,
      to,
      strings,
    });
    expect(events).toEqual([
      { uid: "meal-m1@squirrel-calendar-feed", date: utc(2026, 10, 1), summary: "Dinner: Lasagna" },
    ]);
  });

  it("falls back to the freeform name, then to the slot alone", () => {
    const events = buildCalendarFeedEvents({
      meals: [
        meal({ id: "m1", freeformName: "Takeaway", mealType: "LUNCH" }),
        meal({ id: "m2", mealType: "SNACK" }),
        meal({ id: "m3", freeformName: "   ", mealType: "BREAKFAST" }),
      ],
      bills: [],
      from,
      to,
      strings,
    });
    expect(events.map((e) => e.summary)).toEqual(["Breakfast", "Lunch: Takeaway", "Snack"]);
  });

  it("prefers the recipe name over a freeform name", () => {
    const [event] = buildCalendarFeedEvents({
      meals: [meal({ id: "m1", recipeName: "Soup", freeformName: "Other" })],
      bills: [],
      from,
      to,
      strings,
    });
    expect(event.summary).toBe("Dinner: Soup");
  });

  it("uses the localized strings it's given", () => {
    const [event] = buildCalendarFeedEvents({
      meals: [meal({ id: "m1", recipeName: "Pannkakor" })],
      bills: [bill({ id: "b1", name: "Hyra", dayOfMonth: 1 })],
      from: utc(2026, 10, 1),
      to: utc(2026, 10, 1),
      strings: {
        ...strings,
        billSummary: "Förfaller: {name}",
        mealTypes: { ...strings.mealTypes, DINNER: "Middag" },
      },
    });
    expect(event.summary).toBe("Middag: Pannkakor");
    expect(
      buildCalendarFeedEvents({
        meals: [],
        bills: [bill({ id: "b1", name: "Hyra", dayOfMonth: 1 })],
        from: utc(2026, 10, 1),
        to: utc(2026, 10, 1),
        strings: { ...strings, billSummary: "Förfaller: {name}" },
      })[0].summary,
    ).toBe("Förfaller: Hyra");
  });

  it("drops meals outside the window, keeping both edges", () => {
    const events = buildCalendarFeedEvents({
      meals: [
        meal({ id: "before", date: utc(2026, 8, 31) }),
        meal({ id: "first", date: from }),
        meal({ id: "last", date: to }),
        meal({ id: "after", date: utc(2026, 12, 1) }),
      ],
      bills: [],
      from,
      to,
      strings,
    });
    expect(events.map((e) => e.uid)).toEqual([
      "meal-first@squirrel-calendar-feed",
      "meal-last@squirrel-calendar-feed",
    ]);
  });

  it("expands a monthly bill into one event per due day in the window", () => {
    const events = buildCalendarFeedEvents({
      meals: [],
      bills: [bill({ id: "b1", name: "Rent", dayOfMonth: 25 })],
      from,
      to,
      strings,
    });
    expect(events).toEqual([
      { uid: "bill-b1-20260925@squirrel-calendar-feed", date: utc(2026, 9, 25), summary: "Due: Rent" },
      { uid: "bill-b1-20261025@squirrel-calendar-feed", date: utc(2026, 10, 25), summary: "Due: Rent" },
      { uid: "bill-b1-20261125@squirrel-calendar-feed", date: utc(2026, 11, 25), summary: "Due: Rent" },
    ]);
  });

  it("gives the same UIDs on every build, so clients update instead of duplicating", () => {
    const build = () =>
      buildCalendarFeedEvents({
        meals: [meal({ id: "m1", recipeName: "Soup" })],
        bills: [bill({ id: "b1" })],
        from,
        to,
        strings,
      }).map((e) => e.uid);
    expect(build()).toEqual(build());
    expect(new Set(build()).size).toBe(build().length);
  });

  it("skips bills without a concrete due day", () => {
    const events = buildCalendarFeedEvents({
      meals: [],
      bills: [
        bill({ id: "no-day", dayOfMonth: null }),
        bill({ id: "weekly", frequency: "WEEKLY", dayOfMonth: 3 }),
        bill({ id: "yearly", frequency: "YEARLY", dayOfMonth: 3 }),
      ],
      from,
      to,
      strings,
    });
    expect(events).toEqual([]);
  });

  it("never includes an amount (there's no field for one to leak through)", () => {
    const events = buildCalendarFeedEvents({
      meals: [],
      bills: [{ ...bill({ id: "b1" }), amount: 12345 } as FeedBill],
      from,
      to,
      strings,
    });
    expect(JSON.stringify(events)).not.toContain("12345");
  });

  it("sorts by day, meals in eating order before bills", () => {
    const day = utc(2026, 10, 25);
    const events = buildCalendarFeedEvents({
      meals: [
        meal({ id: "d", date: day, mealType: "DINNER", recipeName: "Stew" }),
        meal({ id: "b", date: day, mealType: "BREAKFAST", recipeName: "Oats" }),
        meal({ id: "early", date: utc(2026, 10, 2), mealType: "SNACK", recipeName: "Apple" }),
      ],
      bills: [bill({ id: "rent", name: "Rent", dayOfMonth: 25 })],
      from: utc(2026, 10, 1),
      to: utc(2026, 10, 31),
      strings,
    });
    expect(events.map((e) => e.summary)).toEqual([
      "Snack: Apple",
      "Breakfast: Oats",
      "Dinner: Stew",
      "Due: Rent",
    ]);
  });
});
