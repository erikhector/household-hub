import { describe, expect, it } from "vitest";
import { isWrappedSeason, wrappedYear } from "@/lib/wrapped/wrapped-season";

describe("wrappedYear", () => {
  it("is the current year from February to December", () => {
    expect(wrappedYear(new Date("2026-02-01T12:00:00Z"), "UTC")).toBe(2026);
    expect(wrappedYear(new Date("2026-11-27T12:00:00Z"), "UTC")).toBe(2026);
    expect(wrappedYear(new Date("2026-12-31T23:00:00Z"), "UTC")).toBe(2026);
  });

  it("is last year all through January", () => {
    expect(wrappedYear(new Date("2027-01-01T00:00:00Z"), "UTC")).toBe(2026);
    expect(wrappedYear(new Date("2027-01-31T23:59:00Z"), "UTC")).toBe(2026);
  });

  it("reads the month on the viewer's clock, not UTC's", () => {
    // 23:30 UTC on 31 January is already 1 February in Stockholm.
    expect(wrappedYear(new Date("2027-01-31T23:30:00Z"), "Europe/Stockholm")).toBe(2027);
    // 02:00 UTC on 1 January is still New Year's Eve in New York.
    expect(wrappedYear(new Date("2027-01-01T02:00:00Z"), "America/New_York")).toBe(2026);
  });
});

describe("isWrappedSeason", () => {
  it("is off before December", () => {
    expect(isWrappedSeason(new Date("2026-11-30T12:00:00Z"), "UTC")).toBe(false);
    expect(isWrappedSeason(new Date("2026-06-15T12:00:00Z"), "UTC")).toBe(false);
  });

  it("is on from 1 December to 15 January", () => {
    expect(isWrappedSeason(new Date("2026-12-01T00:00:00Z"), "UTC")).toBe(true);
    expect(isWrappedSeason(new Date("2026-12-31T23:59:00Z"), "UTC")).toBe(true);
    expect(isWrappedSeason(new Date("2027-01-01T00:00:00Z"), "UTC")).toBe(true);
    expect(isWrappedSeason(new Date("2027-01-15T23:59:00Z"), "UTC")).toBe(true);
  });

  it("is off again from 16 January", () => {
    expect(isWrappedSeason(new Date("2027-01-16T00:00:00Z"), "UTC")).toBe(false);
    expect(isWrappedSeason(new Date("2027-02-01T12:00:00Z"), "UTC")).toBe(false);
  });

  it("uses the viewer's time zone at the edges", () => {
    // 23:30 UTC on 30 November is 1 December in Stockholm, still 30 Nov in UTC.
    const instant = new Date("2026-11-30T23:30:00Z");
    expect(isWrappedSeason(instant, "Europe/Stockholm")).toBe(true);
    expect(isWrappedSeason(instant, "UTC")).toBe(false);
    // 03:00 UTC on 16 January is still the 15th in Los Angeles.
    expect(isWrappedSeason(new Date("2027-01-16T03:00:00Z"), "America/Los_Angeles")).toBe(true);
  });
});
