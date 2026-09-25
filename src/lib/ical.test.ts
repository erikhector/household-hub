import { describe, expect, it } from "vitest";
import {
  buildIcalCalendar,
  escapeIcalText,
  foldIcalLine,
  formatIcalDate,
  formatIcalUtcDateTime,
} from "@/lib/ical";

const octets = (s: string) => new TextEncoder().encode(s).length;

describe("escapeIcalText", () => {
  it("leaves plain text alone", () => {
    expect(escapeIcalText("Lasagna")).toBe("Lasagna");
  });

  it("escapes backslash, semicolon and comma", () => {
    expect(escapeIcalText("a\\b;c,d")).toBe("a\\\\b\\;c\\,d");
  });

  it("escapes the backslash first so it doesn't double-escape the others", () => {
    expect(escapeIcalText("\\,")).toBe("\\\\\\,");
  });

  it("turns every kind of line break into a literal \\n", () => {
    expect(escapeIcalText("a\r\nb\nc\rd")).toBe("a\\nb\\nc\\nd");
  });

  it("drops control characters TEXT doesn't allow, but keeps tabs", () => {
    expect(escapeIcalText("a\u0000b\u0007c\u001Fd\u007Fe\tf")).toBe("abcde\tf");
  });

  it("keeps non-ASCII text as is", () => {
    expect(escapeIcalText("Köttbullar med lingon")).toBe("Köttbullar med lingon");
  });
});

describe("foldIcalLine", () => {
  it("doesn't touch a line of exactly 75 octets", () => {
    const line = "x".repeat(75);
    expect(foldIcalLine(line)).toBe(line);
  });

  it("folds a 76-octet line after 75 octets, continuing with a space", () => {
    const line = "x".repeat(76);
    expect(foldIcalLine(line)).toBe(`${"x".repeat(75)}\r\n x`);
  });

  it("keeps continuation lines to 75 octets including the leading space", () => {
    const line = "y".repeat(300);
    const physical = foldIcalLine(line).split("\r\n");
    expect(physical[0]).toHaveLength(75);
    for (const cont of physical.slice(1)) {
      expect(cont.startsWith(" ")).toBe(true);
      expect(octets(cont)).toBeLessThanOrEqual(75);
    }
    // Unfolding (drop CRLF + one space) gives the original line back.
    expect(foldIcalLine(line).replace(/\r\n /g, "")).toBe(line);
  });

  it("counts octets, not characters, and never splits a multi-byte character", () => {
    // "å" is 2 octets in UTF-8, so 40 of them (80 octets) must fold even
    // though it's only 40 characters.
    const line = "SUMMARY:" + "å".repeat(40);
    const folded = foldIcalLine(line);
    const physical = folded.split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    for (const p of physical) expect(octets(p)).toBeLessThanOrEqual(75);
    // 8 ASCII + 33 × 2 = 74; one more å would make 76.
    expect(physical[0]).toBe("SUMMARY:" + "å".repeat(33));
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("never splits a surrogate pair (4-octet emoji)", () => {
    const line = "SUMMARY:" + "🍝".repeat(30);
    const folded = foldIcalLine(line);
    for (const p of folded.split("\r\n")) {
      expect(octets(p)).toBeLessThanOrEqual(75);
      expect(p).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });
});

describe("date formatting", () => {
  it("formats a DATE from UTC fields", () => {
    expect(formatIcalDate(new Date(Date.UTC(2026, 0, 5)))).toBe("20260105");
  });

  it("uses the UTC day even for a late-evening UTC time", () => {
    expect(formatIcalDate(new Date("2026-03-31T23:30:00Z"))).toBe("20260331");
  });

  it("formats a UTC DATE-TIME with a Z suffix", () => {
    expect(formatIcalUtcDateTime(new Date("2026-09-25T07:08:09.123Z"))).toBe("20260925T070809Z");
  });
});

describe("buildIcalCalendar", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  it("builds an empty but valid calendar with CRLF after every line", () => {
    const ics = buildIcalCalendar({ name: "Home", events: [], now });
    expect(ics).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Squirrel//Household calendar feed//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Home",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
    // No bare LF anywhere.
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes an all-day event with an exclusive next-day DTEND", () => {
    const ics = buildIcalCalendar({
      name: "Home",
      now,
      events: [{ uid: "meal-1@x", date: new Date(Date.UTC(2026, 1, 28)), summary: "Dinner: Tacos" }],
    });
    expect(ics).toContain(
      [
        "BEGIN:VEVENT",
        "UID:meal-1@x",
        "DTSTAMP:20260925T120000Z",
        "DTSTART;VALUE=DATE:20260228",
        "DTEND;VALUE=DATE:20260301",
        "SUMMARY:Dinner: Tacos",
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
      ].join("\r\n"),
    );
  });

  it("rolls DTEND over year boundaries", () => {
    const ics = buildIcalCalendar({
      name: "Home",
      now,
      events: [{ uid: "u", date: new Date(Date.UTC(2026, 11, 31)), summary: "NYE" }],
    });
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
  });

  it("escapes the summary, description and calendar name", () => {
    const ics = buildIcalCalendar({
      name: "Smith, Jones; Co",
      now,
      events: [{ uid: "u", date: new Date(Date.UTC(2026, 0, 1)), summary: "Fish, chips", description: "a\nb" }],
    });
    expect(ics).toContain("X-WR-CALNAME:Smith\\, Jones\\; Co\r\n");
    expect(ics).toContain("SUMMARY:Fish\\, chips\r\n");
    expect(ics).toContain("DESCRIPTION:a\\nb\r\n");
  });

  it("omits DESCRIPTION when there is none", () => {
    const ics = buildIcalCalendar({
      name: "Home",
      now,
      events: [{ uid: "u", date: new Date(Date.UTC(2026, 0, 1)), summary: "S" }],
    });
    expect(ics).not.toContain("DESCRIPTION");
  });

  it("adds both refresh-interval properties when asked", () => {
    const ics = buildIcalCalendar({ name: "Home", events: [], now, refreshInterval: "PT6H" });
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT6H\r\n");
    expect(ics).toContain("X-PUBLISHED-TTL:PT6H\r\n");
  });

  it("folds long lines so no physical line exceeds 75 octets", () => {
    const ics = buildIcalCalendar({
      name: "Home",
      now,
      events: [{ uid: "u", date: new Date(Date.UTC(2026, 0, 1)), summary: "Middag: " + "Räksmörgås ".repeat(20) }],
    });
    for (const line of ics.split("\r\n")) expect(octets(line)).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("SUMMARY:Middag: " + "Räksmörgås ".repeat(20).trimEnd());
  });

  it("keeps events in the order given", () => {
    const ics = buildIcalCalendar({
      name: "Home",
      now,
      events: [
        { uid: "b", date: new Date(Date.UTC(2026, 0, 2)), summary: "B" },
        { uid: "a", date: new Date(Date.UTC(2026, 0, 1)), summary: "A" },
      ],
    });
    expect(ics.indexOf("UID:b")).toBeLessThan(ics.indexOf("UID:a"));
  });
});
