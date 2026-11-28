// Tests the .ics reader behind the calendar's "Import from file" (GAP-92):
// which RRULEs become a Squirrel repeat and which import as a one-off, all
// day vs timed, zoned times moved into the importer's zone, and the file's
// own limits. Plain fixtures, no I/O.
import { describe, expect, it } from "vitest";
import { ICS_FILE_MAX_BYTES, ICS_MAX_EVENTS, parseIcs, parseIcsFile } from "@/lib/ics-import";
import { expandEventOccurrences, eventRrule, parseEventDate } from "@/lib/household-events";

/** A calendar of the given VEVENT bodies, CRLF-terminated like a real export. */
function calendar(...events: string[][]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN"];
  for (const event of events) lines.push("BEGIN:VEVENT", ...event, "END:VEVENT");
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function only(text: string, timeZone = "UTC") {
  const result = parseIcs(text, timeZone);
  if (!result.ok) throw new Error(`parse failed: ${result.error}`);
  expect(result.events).toHaveLength(1);
  return result.events[0];
}

/** The recurrence one event with this DTSTART and RRULE imports as. */
function repeatOf(dtstart: string, rrule: string) {
  return only(calendar(["SUMMARY:Event", `DTSTART;VALUE=DATE:${dtstart}`, `RRULE:${rrule}`])).recurrence;
}

describe("parseIcs: what an event becomes", () => {
  it("reads an all-day event: title, day, no times", () => {
    expect(
      only(calendar(["UID:1", "SUMMARY:Sports day", "DTSTART;VALUE=DATE:20270312", "DTEND;VALUE=DATE:20270313"])),
    ).toEqual({ title: "Sports day", date: "2027-03-12", startTime: "", endTime: "", notes: "", recurrence: "" });
  });

  it("reads a floating timed event with its end, as written", () => {
    const row = only(calendar(["SUMMARY:Dentist", "DTSTART:20270312T143000", "DTEND:20270312T151500"]), "America/New_York");
    expect(row).toMatchObject({ date: "2027-03-12", startTime: "14:30", endTime: "15:15" });
  });

  it("works the end out from a DURATION", () => {
    expect(only(calendar(["SUMMARY:Match", "DTSTART:20270312T100000", "DURATION:PT1H30M"]))).toMatchObject({
      startTime: "10:00",
      endTime: "11:30",
    });
  });

  it("drops an end that isn't later the same day", () => {
    expect(only(calendar(["SUMMARY:Night shift", "DTSTART:20270312T220000", "DTEND:20270313T060000"]))).toMatchObject({
      startTime: "22:00",
      endTime: "",
    });
  });

  it("moves a UTC time into the importer's zone, day included", () => {
    // 23:30 UTC on 12 March is 00:30 on the 13th in Stockholm (UTC+1 in March before DST).
    const row = only(calendar(["SUMMARY:Call", "DTSTART:20270312T233000Z", "DTEND:20270313T000000Z"]), "Europe/Stockholm");
    expect(row).toMatchObject({ date: "2027-03-13", startTime: "00:30", endTime: "01:00" });
  });

  it("moves a TZID time into the importer's zone, across a DST difference", () => {
    // 09:00 in New York on 1 July (UTC-4) is 15:00 in Stockholm (UTC+2).
    const row = only(
      calendar(['SUMMARY:Standup', 'DTSTART;TZID="America/New_York":20270701T090000', "DTEND;TZID=America/New_York:20270701T093000"]),
      "Europe/Stockholm",
    );
    expect(row).toMatchObject({ date: "2027-07-01", startTime: "15:00", endTime: "15:30" });
  });

  it("keeps the wall clock of a TZID it can't look up", () => {
    expect(
      only(calendar(["SUMMARY:Meeting", "DTSTART;TZID=W. Europe Standard Time:20270312T090000"]), "America/New_York"),
    ).toMatchObject({ date: "2027-03-12", startTime: "09:00" });
  });

  it("unfolds lines and unescapes TEXT; notes come from DESCRIPTION, not an alarm's", () => {
    const row = only(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "SUMMARY:Parents\\, teachers\\; and",
        "  kids",
        "DTSTART;VALUE=DATE:20270312",
        "DESCRIPTION:Bring snacks\\nRoom 4",
        "BEGIN:VALARM",
        "DESCRIPTION:Reminder",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
    );
    expect(row.title).toBe("Parents, teachers; and kids");
    expect(row.notes).toBe("Bring snacks\nRoom 4");
  });

  it("cuts a long title at the cap instead of refusing it", () => {
    expect(only(calendar([`SUMMARY:${"a".repeat(200)}`, "DTSTART;VALUE=DATE:20270312"])).title).toHaveLength(120);
  });

  it("skips a cancelled event and one with no readable DTSTART", () => {
    const result = parseIcs(
      calendar(
        ["SUMMARY:Kept", "DTSTART;VALUE=DATE:20270312"],
        ["SUMMARY:Cancelled", "STATUS:CANCELLED", "DTSTART;VALUE=DATE:20270313"],
        ["SUMMARY:No start"],
        ["SUMMARY:Bad date", "DTSTART;VALUE=DATE:20270230"],
      ),
      "UTC",
    );
    expect(result).toEqual({ ok: true, skipped: 3, events: [expect.objectContaining({ title: "Kept" })] });
  });
});

describe("parseIcs: RRULEs taken as a Squirrel repeat", () => {
  it("weekly with no BYDAY", () => {
    expect(repeatOf("20270312", "FREQ=WEEKLY")).toBe("WEEKLY");
  });

  it("weekly with a BYDAY of DTSTART's own weekday (12 March 2027 is a Friday)", () => {
    expect(repeatOf("20270312", "FREQ=WEEKLY;WKST=MO;BYDAY=FR")).toBe("WEEKLY");
    expect(repeatOf("20270312", "FREQ=WEEKLY;INTERVAL=1;BYDAY=FR")).toBe("WEEKLY");
  });

  it("monthly on the 15th", () => {
    expect(repeatOf("20270315", "FREQ=MONTHLY")).toBe("MONTHLY");
  });

  it("the clamped monthly form Squirrel's own feed writes for the 31st and the 30th", () => {
    expect(repeatOf("20270131", "FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1")).toBe("MONTHLY");
    expect(repeatOf("20270130", "FREQ=MONTHLY;BYSETPOS=-1;BYMONTHDAY=28,29,30")).toBe("MONTHLY");
  });

  it("yearly, and the clamped form for 29 February", () => {
    expect(repeatOf("20270612", "FREQ=YEARLY")).toBe("YEARLY");
    expect(repeatOf("20280229", "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1")).toBe("YEARLY");
  });

  it("round-trips every rule eventRrule writes, landing on the same days", () => {
    const from = parseEventDate("2027-01-01")!;
    const to = parseEventDate("2031-12-31")!;
    for (const [date, recurrence] of [
      ["2027-01-31", "MONTHLY"],
      ["2027-01-29", "MONTHLY"],
      ["2027-01-15", "MONTHLY"],
      ["2028-02-29", "YEARLY"],
      ["2027-06-12", "YEARLY"],
      ["2027-03-12", "WEEKLY"],
    ] as const) {
      const event = { date: parseEventDate(date)!, recurrence };
      const imported = repeatOf(date.replace(/-/g, ""), eventRrule(event)!);
      expect(imported).toBe(recurrence);
      expect(expandEventOccurrences({ date: event.date, recurrence: imported || null }, from, to)).toEqual(
        expandEventOccurrences(event, from, to),
      );
    }
  });
});

describe("parseIcs: RRULEs that import as a one-off on DTSTART", () => {
  it.each([
    ["a COUNT", "20270312", "FREQ=WEEKLY;COUNT=10"],
    ["an UNTIL", "20270312", "FREQ=WEEKLY;UNTIL=20270601T000000Z"],
    ["an INTERVAL above 1", "20270312", "FREQ=WEEKLY;INTERVAL=2"],
    ["a BYDAY list", "20270312", "FREQ=WEEKLY;BYDAY=MO,WE,FR"],
    ["a BYDAY other than DTSTART's weekday", "20270312", "FREQ=WEEKLY;BYDAY=MO"],
    ["a plain monthly on the 31st", "20270131", "FREQ=MONTHLY"],
    ["a plain monthly on the 29th", "20270129", "FREQ=MONTHLY"],
    ["a monthly BYDAY", "20270312", "FREQ=MONTHLY;BYDAY=2FR"],
    ["a clamped monthly whose list doesn't end on DTSTART's day", "20270130", "FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1"],
    ["a plain yearly on 29 February", "20280229", "FREQ=YEARLY"],
    ["any other BY part on a yearly", "20270612", "FREQ=YEARLY;BYMONTH=6"],
    ["a daily", "20270312", "FREQ=DAILY"],
  ])("%s", (_, dtstart, rrule) => {
    const row = only(calendar(["SUMMARY:Event", `DTSTART;VALUE=DATE:${dtstart}`, `RRULE:${rrule}`]));
    expect(row.recurrence).toBe("");
    expect(row.date).toBe(`${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6)}`);
  });

  // The zone move puts the row on a later day than DTSTART as written, and
  // Squirrel repeats from the row's day: the 29th clamps to 28 February where
  // the source's February occurrence is 1 March in Stockholm, and 1 March
  // yearly misses the leap years' 29 February.
  it.each([
    ["a monthly the move puts on the 29th", "20270128T233000Z", "FREQ=MONTHLY", "2027-01-29"],
    ["a yearly the move puts on 1 March", "20270228T233000Z", "FREQ=YEARLY", "2027-03-01"],
  ])("%s", (_, dtstart, rrule, date) => {
    const row = only(calendar(["SUMMARY:Event", `DTSTART:${dtstart}`, `RRULE:${rrule}`]), "Europe/Stockholm");
    expect(row).toMatchObject({ date, recurrence: "" });
  });

  it("but keeps a repeat the move doesn't break, on the moved day", () => {
    const moved = (dtstart: string, rrule: string) =>
      only(calendar(["SUMMARY:Event", `DTSTART:${dtstart}`, `RRULE:${rrule}`]), "Europe/Stockholm");
    expect(moved("20270114T233000Z", "FREQ=MONTHLY")).toMatchObject({ date: "2027-01-15", recurrence: "MONTHLY" });
    expect(moved("20270611T223000Z", "FREQ=YEARLY")).toMatchObject({ date: "2027-06-12", recurrence: "YEARLY" });
    expect(moved("20270311T233000Z", "FREQ=WEEKLY")).toMatchObject({ date: "2027-03-12", recurrence: "WEEKLY" });
  });

  it("a weekly series with an EXDATE, or with a moved instance, and the moved instance itself", () => {
    const result = parseIcs(
      calendar(
        ["UID:a", "SUMMARY:Swim", "DTSTART;VALUE=DATE:20270312", "RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20270319"],
        ["UID:b", "SUMMARY:Choir", "DTSTART;VALUE=DATE:20270312", "RRULE:FREQ=WEEKLY"],
        ["UID:b", "SUMMARY:Choir", "RECURRENCE-ID;VALUE=DATE:20270319", "DTSTART;VALUE=DATE:20270320"],
      ),
      "UTC",
    );
    expect(result.ok && result.events.map((e) => [e.date, e.recurrence])).toEqual([
      ["2027-03-12", ""],
      ["2027-03-12", ""],
      ["2027-03-20", ""],
    ]);
  });
});

describe("parseIcsFile: the file itself", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("refuses an empty file, one over the cap, and one that isn't iCalendar", () => {
    expect(parseIcsFile(new Uint8Array(), "UTC")).toEqual({ ok: false, error: "empty" });
    expect(parseIcsFile(new Uint8Array(ICS_FILE_MAX_BYTES + 1), "UTC")).toEqual({ ok: false, error: "tooLarge" });
    expect(parseIcsFile(bytes("name,date\nDentist,2027-03-12\n"), "UTC")).toEqual({ ok: false, error: "unsupported" });
  });

  it("refuses a calendar with no events, and one with too many", () => {
    expect(parseIcsFile(bytes(calendar()), "UTC")).toEqual({ ok: false, error: "noEvents" });
    const many = Array.from({ length: ICS_MAX_EVENTS + 1 }, () => ["SUMMARY:x", "DTSTART;VALUE=DATE:20270312"]);
    expect(parseIcsFile(bytes(calendar(...many)), "UTC")).toEqual({ ok: false, error: "tooMany" });
  });

  it("reads UTF-8 with a byte-order mark", () => {
    const result = parseIcsFile(bytes(`﻿${calendar(["SUMMARY:Skolavslutning å", "DTSTART;VALUE=DATE:20270611"])}`), "UTC");
    expect(result.ok && result.events[0].title).toBe("Skolavslutning å");
  });
});
