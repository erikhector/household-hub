import { describe, expect, it } from "vitest";
import {
  AGENDA_DAYS,
  AGENDA_MAX_DAYS,
  agendaWindow,
  buildAgenda,
  eventDayLabel,
  dueReminderOccurrence,
  eventDateKey,
  eventDayNumber,
  eventRrule,
  expandEventOccurrences,
  isEventTime,
  parseEventDate,
  type AgendaEvent,
  type EventRecurrence,
} from "./household-events";

const d = (key: string) => {
  const date = parseEventDate(key);
  if (!date) throw new Error(`bad date ${key}`);
  return date;
};
const keys = (dates: Date[]) => dates.map(eventDateKey);
const expand = (date: string, recurrence: EventRecurrence | null, from: string, to: string) =>
  keys(expandEventOccurrences({ date: d(date), recurrence }, d(from), d(to)));

describe("parseEventDate", () => {
  it("reads a real date as its UTC midnight", () => {
    expect(parseEventDate("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("rejects a date that doesn't exist or isn't a date", () => {
    expect(parseEventDate("2026-02-29")).toBeNull();
    expect(parseEventDate("2026-13-01")).toBeNull();
    expect(parseEventDate("tomorrow")).toBeNull();
    expect(parseEventDate("")).toBeNull();
  });
});

describe("isEventTime", () => {
  it("accepts 24-hour HH:MM", () => {
    expect(isEventTime("00:00")).toBe(true);
    expect(isEventTime("14:30")).toBe(true);
    expect(isEventTime("23:59")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isEventTime("24:00")).toBe(false);
    expect(isEventTime("9:30")).toBe(false);
    expect(isEventTime("12:60")).toBe(false);
    expect(isEventTime("12:30:00")).toBe(false);
  });
});

describe("expandEventOccurrences", () => {
  it("lists a one-off only when it is inside the window", () => {
    expect(expand("2026-12-03", null, "2026-12-01", "2026-12-31")).toEqual(["2026-12-03"]);
    expect(expand("2026-11-30", null, "2026-12-01", "2026-12-31")).toEqual([]);
    expect(expand("2027-01-01", null, "2026-12-01", "2026-12-31")).toEqual([]);
  });

  it("includes both ends of the window", () => {
    expect(expand("2026-12-01", null, "2026-12-01", "2026-12-31")).toEqual(["2026-12-01"]);
    expect(expand("2026-12-31", null, "2026-12-01", "2026-12-31")).toEqual(["2026-12-31"]);
  });

  it("repeats weekly from the event's own date, never before it", () => {
    expect(expand("2026-12-02", "WEEKLY", "2026-11-25", "2026-12-20")).toEqual([
      "2026-12-02",
      "2026-12-09",
      "2026-12-16",
    ]);
  });

  it("keeps a weekly event on its weekday when the window starts mid-week", () => {
    // 2026-11-04 is a Wednesday; the window opens on a Friday.
    expect(expand("2026-11-04", "WEEKLY", "2026-11-27", "2026-12-10")).toEqual(["2026-12-02", "2026-12-09"]);
  });

  it("repeats monthly on the same day", () => {
    expect(expand("2026-10-15", "MONTHLY", "2026-11-01", "2027-01-31")).toEqual([
      "2026-11-15",
      "2026-12-15",
      "2027-01-15",
    ]);
  });

  it("clamps a monthly event on the 31st to a short month's end without drifting", () => {
    expect(expand("2027-01-31", "MONTHLY", "2027-01-01", "2027-05-31")).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
    ]);
  });

  it("puts a monthly event on the 30th on 29 February in a leap year", () => {
    expect(expand("2028-01-30", "MONTHLY", "2028-02-01", "2028-03-31")).toEqual(["2028-02-29", "2028-03-30"]);
  });

  it("skips a clamped month-end day that falls before the window", () => {
    expect(expand("2027-01-31", "MONTHLY", "2027-03-01", "2027-03-31")).toEqual(["2027-03-31"]);
  });

  it("repeats yearly on the same day and month", () => {
    expect(expand("2020-06-12", "YEARLY", "2026-01-01", "2028-12-31")).toEqual([
      "2026-06-12",
      "2027-06-12",
      "2028-06-12",
    ]);
  });

  it("puts a 29 February birthday on the 28th in other years", () => {
    expect(expand("2024-02-29", "YEARLY", "2026-01-01", "2028-12-31")).toEqual([
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });

  it("starts a yearly event no earlier than its own date", () => {
    expect(expand("2027-03-10", "YEARLY", "2026-01-01", "2027-12-31")).toEqual(["2027-03-10"]);
  });

  it("returns nothing for a window that ends before the event starts", () => {
    expect(expand("2027-03-10", "WEEKLY", "2026-01-01", "2026-12-31")).toEqual([]);
  });
});

describe("dueReminderOccurrence (GAP-88a)", () => {
  const due = (
    date: string,
    recurrence: EventRecurrence | null,
    reminder: "MORNING_OF" | "DAY_BEFORE" | null,
    today: string,
  ) => {
    const occurrence = dueReminderOccurrence({ date: d(date), recurrence, reminder }, eventDayNumber(d(today)));
    return occurrence ? eventDateKey(occurrence) : null;
  };

  it("is due on the event's own day for the morning of", () => {
    expect(due("2026-12-03", null, "MORNING_OF", "2026-12-03")).toBe("2026-12-03");
    expect(due("2026-12-03", null, "MORNING_OF", "2026-12-02")).toBeNull();
  });

  it("is due on the day before for the day before", () => {
    expect(due("2026-12-03", null, "DAY_BEFORE", "2026-12-02")).toBe("2026-12-03");
    expect(due("2026-12-03", null, "DAY_BEFORE", "2026-12-03")).toBeNull();
  });

  it("never reminds late once the day has passed", () => {
    expect(due("2026-12-03", null, "MORNING_OF", "2026-12-04")).toBeNull();
    expect(due("2026-12-03", null, "DAY_BEFORE", "2026-12-04")).toBeNull();
  });

  it("is due for every occurrence of a repeat, and not before it starts", () => {
    expect(due("2026-12-03", "WEEKLY", "MORNING_OF", "2026-12-17")).toBe("2026-12-17");
    expect(due("2026-12-03", "YEARLY", "DAY_BEFORE", "2027-12-02")).toBe("2027-12-03");
    expect(due("2026-12-03", "WEEKLY", "MORNING_OF", "2026-11-26")).toBeNull();
    // A monthly event on the 31st is on 30 April, so the day before is the 29th.
    expect(due("2027-01-31", "MONTHLY", "DAY_BEFORE", "2027-04-29")).toBe("2027-04-30");
  });

  it("is never due without a reminder", () => {
    expect(due("2026-12-03", null, null, "2026-12-03")).toBeNull();
  });
});

describe("eventRrule", () => {
  const rule = (date: string, recurrence: EventRecurrence | null) => eventRrule({ date: d(date), recurrence });

  it("has no rule for a one-off", () => {
    expect(rule("2026-12-03", null)).toBeNull();
  });

  it("uses the plain frequency where the date exists every time", () => {
    expect(rule("2026-12-03", "WEEKLY")).toBe("FREQ=WEEKLY");
    expect(rule("2026-12-28", "MONTHLY")).toBe("FREQ=MONTHLY");
    expect(rule("2026-06-12", "YEARLY")).toBe("FREQ=YEARLY");
  });

  it("clamps a monthly day past the 28th to the month's last day", () => {
    expect(rule("2027-01-29", "MONTHLY")).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1");
    expect(rule("2027-01-30", "MONTHLY")).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1");
    expect(rule("2027-01-31", "MONTHLY")).toBe("FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
  });

  it("puts a 29 February birthday on the 28th in other years", () => {
    expect(rule("2024-02-29", "YEARLY")).toBe("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1");
  });
});

describe("buildAgenda", () => {
  const event = (overrides: Partial<AgendaEvent> & { id: string; date: Date }): AgendaEvent => ({
    title: overrides.id,
    startTime: null,
    endTime: null,
    recurrence: null,
    ...overrides,
  });

  it("groups occurrences by day, oldest day first, skipping empty days", () => {
    const agenda = buildAgenda(
      [
        event({ id: "later", date: d("2026-12-10") }),
        event({ id: "swim", date: d("2026-12-02"), recurrence: "WEEKLY" }),
      ],
      d("2026-12-01"),
      d("2026-12-10"),
    );
    expect(agenda.map((day) => [day.key, day.events.map((e) => e.id)])).toEqual([
      ["2026-12-02", ["swim"]],
      ["2026-12-09", ["swim"]],
      ["2026-12-10", ["later"]],
    ]);
  });

  it("dates each occurrence on the day it falls, keeping the rest of the event", () => {
    const [, second] = buildAgenda(
      [event({ id: "swim", title: "Swimming", date: d("2026-12-02"), recurrence: "WEEKLY", startTime: "17:00" })],
      d("2026-12-01"),
      d("2026-12-10"),
    );
    expect(eventDateKey(second.events[0].date)).toBe("2026-12-09");
    expect(second.events[0]).toMatchObject({ id: "swim", title: "Swimming", startTime: "17:00" });
  });

  it("puts all-day events first, then orders by start time, then title", () => {
    const [day] = buildAgenda(
      [
        event({ id: "c", title: "Piano", date: d("2026-12-05"), startTime: "16:00" }),
        event({ id: "b", title: "Dentist", date: d("2026-12-05"), startTime: "09:30" }),
        event({ id: "a", title: "Zoe's birthday", date: d("2026-12-05") }),
        event({ id: "d", title: "Bake sale", date: d("2026-12-05"), startTime: "16:00" }),
      ],
      d("2026-12-01"),
      d("2026-12-10"),
    );
    expect(day.events.map((e) => e.title)).toEqual(["Zoe's birthday", "Dentist", "Bake sale", "Piano"]);
  });
});

describe("agendaWindow (GAP-91)", () => {
  const today = eventDayNumber(d("2026-12-01"));

  it("is the default 60 days with no until, a malformed one or one too near", () => {
    const standard = {
      days: AGENDA_DAYS,
      end: "2027-01-29",
      maxEnd: "2028-11-29",
      laterUntil: "2027-03-30",
    };
    expect(agendaWindow(today, undefined)).toEqual(standard);
    expect(agendaWindow(today, "next-week")).toEqual(standard);
    expect(agendaWindow(today, "2027-02-30")).toEqual(standard);
    expect(agendaWindow(today, "2026-12-10")).toEqual(standard);
    expect(agendaWindow(today, "2025-01-01")).toEqual(standard);
  });

  it("runs to until, inclusive, and Show later goes 60 days past it", () => {
    expect(agendaWindow(today, "2027-03-01")).toEqual({
      days: 91,
      end: "2027-03-01",
      maxEnd: "2028-11-29",
      laterUntil: "2027-04-30",
    });
  });

  it("stops at the cap, and Show later stops with it", () => {
    expect(agendaWindow(today, "2028-10-15").laterUntil).toBe("2028-11-29");
    const capped = agendaWindow(today, "2031-01-01");
    expect(capped.days).toBe(AGENDA_MAX_DAYS);
    expect(capped.end).toBe("2028-11-29");
    expect(capped.laterUntil).toBeNull();
  });
});

describe("eventDayLabel (GAP-91)", () => {
  it("names the day, with the year only when it differs", () => {
    expect(eventDayLabel("2027-02-27", "en", 2027)).toBe("Saturday, February 27");
    expect(eventDayLabel("2027-02-27", "en", 2026)).toBe("Saturday, February 27, 2027");
    expect(eventDayLabel("2027-02-27", "sv", 2027)).toBe("Lördag 27 februari");
  });
});
