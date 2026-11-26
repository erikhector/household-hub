// GAP-35: the upcoming-events loader (query scope, agenda, the "nothing yet"
// flag) and the labels the calendar page and Home show. Prisma is mocked.
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeEventTime, eventDayNumber, parseEventDate } from "@/lib/household-events";

vi.mock("server-only", () => ({}));

const { findManyMock, findFirstMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(async (): Promise<unknown[]> => []),
  findFirstMock: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { householdEvent: { findMany: findManyMock, findFirst: findFirstMock } },
}));

const { loadUpcomingEvents, upcomingDayHeading } = await import("./upcoming");

const d = (key: string) => parseEventDate(key)!;
const dayOf = (key: string) => eventDayNumber(d(key));

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadUpcomingEvents", () => {
  it("asks only for this household's one-offs in the window and repeats started by its end", async () => {
    await loadUpcomingEvents("household-1", dayOf("2026-12-01"), 7);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          householdId: "household-1",
          date: { lte: d("2026-12-07") },
          OR: [{ recurrence: { not: null } }, { date: { gte: d("2026-12-01") } }],
        },
      }),
    );
  });

  it("expands repeats into the window and keeps the series' own date", async () => {
    findManyMock.mockResolvedValueOnce([
      {
        id: "swim",
        title: "Swimming",
        date: d("2026-11-04"),
        startTime: "17:00",
        endTime: null,
        notes: null,
        forMemberId: null,
        recurrence: "WEEKLY",
      },
    ]);

    const { days, hasEvents } = await loadUpcomingEvents("household-1", dayOf("2026-12-01"), 14);

    expect(hasEvents).toBe(true);
    expect(days.map((day) => day.key)).toEqual(["2026-12-02", "2026-12-09"]);
    expect(days[0].events[0].seriesDate).toEqual(d("2026-11-04"));
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("tells an empty calendar from one with nothing coming up", async () => {
    expect((await loadUpcomingEvents("household-1", dayOf("2026-12-01"), 7)).hasEvents).toBe(false);
    expect(findFirstMock).toHaveBeenCalledWith({ where: { householdId: "household-1" }, select: { id: true } });

    findFirstMock.mockResolvedValueOnce({ id: "old" });
    expect((await loadUpcomingEvents("household-1", dayOf("2026-12-01"), 7)).hasEvents).toBe(true);
  });
});

describe("describeEventTime", () => {
  const dict = { allDay: "All day", timeRange: "{start}–{end}" };

  it("says all day with no start time", () => {
    expect(describeEventTime({ startTime: null, endTime: null }, "en", dict)).toBe("All day");
  });

  it("shows a start, or a start and end, in the locale's clock", () => {
    expect(describeEventTime({ startTime: "14:30", endTime: null }, "sv", dict)).toBe("14:30");
    expect(describeEventTime({ startTime: "09:00", endTime: "10:15" }, "sv", dict)).toBe("9:00–10:15");
    expect(describeEventTime({ startTime: "14:30", endTime: null }, "en", dict)).toMatch(/^2:30\sPM$/);
  });
});

describe("upcomingDayHeading", () => {
  const dict = { today: "Today", tomorrow: "Tomorrow" };
  const today = dayOf("2026-12-03");

  it("names today and tomorrow before the date", () => {
    expect(upcomingDayHeading(d("2026-12-03"), today, "en", dict, "long")).toBe("Today, Thursday, December 3");
    expect(upcomingDayHeading(d("2026-12-04"), today, "en", dict, "short")).toBe("Tomorrow, Fri, Dec 4");
  });

  it("capitalises a Swedish weekday and adds the year only when it differs", () => {
    expect(upcomingDayHeading(d("2026-12-07"), today, "sv", { today: "Idag", tomorrow: "Imorgon" }, "long")).toBe(
      "Måndag 7 december",
    );
    expect(upcomingDayHeading(d("2027-01-04"), today, "sv", { today: "Idag", tomorrow: "Imorgon" }, "long")).toBe(
      "Måndag 4 januari 2027",
    );
  });
});
