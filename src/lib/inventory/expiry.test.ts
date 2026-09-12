import { describe, expect, it } from "vitest";
import { EXPIRY_WARNING_DAYS, getExpiryStatus } from "@/lib/inventory/expiry";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-15T12:00:00Z").getTime();

describe("getExpiryStatus", () => {
  it("returns null when no expiry date is set", () => {
    expect(getExpiryStatus(null, NOW)).toBeNull();
  });

  it("returns null when the expiry date is further away than the warning window", () => {
    const farOut = new Date(NOW + (EXPIRY_WARNING_DAYS + 1) * DAY_MS);
    expect(getExpiryStatus(farOut, NOW)).toBeNull();
  });

  it("returns 'soon' at exactly the warning window boundary", () => {
    const atBoundary = new Date(NOW + EXPIRY_WARNING_DAYS * DAY_MS);
    expect(getExpiryStatus(atBoundary, NOW)).toBe("soon");
  });

  it("returns 'soon' for a date within the warning window", () => {
    const tomorrow = new Date(NOW + DAY_MS);
    expect(getExpiryStatus(tomorrow, NOW)).toBe("soon");
  });

  it("returns 'soon' for a date expiring today", () => {
    const laterToday = new Date(NOW + 1000);
    expect(getExpiryStatus(laterToday, NOW)).toBe("soon");
  });

  it("returns 'expired' for a date in the past", () => {
    const yesterday = new Date(NOW - DAY_MS);
    expect(getExpiryStatus(yesterday, NOW)).toBe("expired");
  });
});
