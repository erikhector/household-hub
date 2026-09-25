// Tests src/lib/quiet-hours.ts. Every case passes an explicit `now` and time
// zone, so results don't depend on the machine's clock or TZ.
import { describe, expect, it } from "vitest";
import { isValidTimeZone, isWithinQuietHours, localHourIn } from "@/lib/quiet-hours";

// 2026-01-15 is outside DST in both Stockholm (UTC+1) and New York (UTC-5).
const at = (isoUtc: string) => new Date(isoUtc);

describe("localHourIn", () => {
  it("converts to the stored zone's wall-clock hour", () => {
    expect(localHourIn("Europe/Stockholm", at("2026-01-15T22:30:00Z"))).toBe(23);
    expect(localHourIn("America/New_York", at("2026-01-15T03:00:00Z"))).toBe(22);
  });

  it("reports midnight as 0, not 24", () => {
    expect(localHourIn("UTC", at("2026-01-15T00:15:00Z"))).toBe(0);
  });

  it("follows DST", () => {
    // Stockholm is UTC+2 in July.
    expect(localHourIn("Europe/Stockholm", at("2026-07-15T20:00:00Z"))).toBe(22);
  });

  it("returns null for a missing or unrecognised zone", () => {
    expect(localHourIn(null, at("2026-01-15T12:00:00Z"))).toBeNull();
    expect(localHourIn("", at("2026-01-15T12:00:00Z"))).toBeNull();
    expect(localHourIn("Mars/Olympus_Mons", at("2026-01-15T12:00:00Z"))).toBeNull();
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(isValidTimeZone("Europe/Stockholm")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("isWithinQuietHours", () => {
  it("handles a same-day window as half-open [start, end)", () => {
    expect(isWithinQuietHours(13, 15, "UTC", at("2026-01-15T12:59:00Z"))).toBe(false);
    expect(isWithinQuietHours(13, 15, "UTC", at("2026-01-15T13:00:00Z"))).toBe(true);
    expect(isWithinQuietHours(13, 15, "UTC", at("2026-01-15T14:59:00Z"))).toBe(true);
    expect(isWithinQuietHours(13, 15, "UTC", at("2026-01-15T15:00:00Z"))).toBe(false);
  });

  it("handles a window that wraps midnight", () => {
    expect(isWithinQuietHours(22, 7, "UTC", at("2026-01-15T21:59:00Z"))).toBe(false);
    expect(isWithinQuietHours(22, 7, "UTC", at("2026-01-15T22:00:00Z"))).toBe(true);
    expect(isWithinQuietHours(22, 7, "UTC", at("2026-01-15T00:30:00Z"))).toBe(true);
    expect(isWithinQuietHours(22, 7, "UTC", at("2026-01-15T06:59:00Z"))).toBe(true);
    expect(isWithinQuietHours(22, 7, "UTC", at("2026-01-15T07:00:00Z"))).toBe(false);
    expect(isWithinQuietHours(22, 7, "UTC", at("2026-01-15T12:00:00Z"))).toBe(false);
  });

  it("evaluates the window in the subscription's own zone, not the server's", () => {
    // 21:30 UTC is 22:30 in Stockholm — quiet there, not in UTC.
    const now = at("2026-01-15T21:30:00Z");
    expect(isWithinQuietHours(22, 7, "Europe/Stockholm", now)).toBe(true);
    expect(isWithinQuietHours(22, 7, "UTC", now)).toBe(false);
  });

  it("treats start === end as no quiet hours", () => {
    expect(isWithinQuietHours(8, 8, "UTC", at("2026-01-15T08:30:00Z"))).toBe(false);
  });

  it("treats a missing hour as no quiet hours", () => {
    expect(isWithinQuietHours(null, 7, "UTC", at("2026-01-15T03:00:00Z"))).toBe(false);
    expect(isWithinQuietHours(22, null, "UTC", at("2026-01-15T23:00:00Z"))).toBe(false);
    expect(isWithinQuietHours(undefined, undefined, "UTC", at("2026-01-15T23:00:00Z"))).toBe(false);
  });

  it("treats an out-of-range hour as no quiet hours", () => {
    expect(isWithinQuietHours(22, 24, "UTC", at("2026-01-15T23:00:00Z"))).toBe(false);
    expect(isWithinQuietHours(-1, 7, "UTC", at("2026-01-15T03:00:00Z"))).toBe(false);
  });

  it("fails open when the time zone is missing or invalid", () => {
    expect(isWithinQuietHours(22, 7, null, at("2026-01-15T23:00:00Z"))).toBe(false);
    expect(isWithinQuietHours(22, 7, "Not/AZone", at("2026-01-15T23:00:00Z"))).toBe(false);
  });
});
