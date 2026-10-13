import { describe, expect, it } from "vitest";
import {
  DEFAULT_USE_WITHIN_DAYS_FROZEN,
  EXPIRY_WARNING_DAYS,
  frozenExpiryUpdate,
  frozenResetOnArrival,
  getExpiryStatus,
  openedExpiryUpdate,
  openedResetOnArrival,
} from "@/lib/inventory/expiry";

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

describe("openedExpiryUpdate", () => {
  const now = new Date("2026-09-25T10:00:00Z");

  it("returns null when no opened window is set", () => {
    expect(openedExpiryUpdate({ expiresAt: null, expiresAtEstimated: false }, null, now)).toBeNull();
  });

  it("returns null for a non-positive or non-integer window", () => {
    expect(openedExpiryUpdate({ expiresAt: null, expiresAtEstimated: false }, 0, now)).toBeNull();
    expect(openedExpiryUpdate({ expiresAt: null, expiresAtEstimated: false }, -1, now)).toBeNull();
    expect(openedExpiryUpdate({ expiresAt: null, expiresAtEstimated: false }, 1.5, now)).toBeNull();
  });

  it("uses the opened date (flagged estimated) when there's no existing expiry", () => {
    expect(openedExpiryUpdate({ expiresAt: null, expiresAtEstimated: false }, 3, now)).toEqual({
      openedAt: now,
      expiresAt: new Date("2026-09-28T10:00:00Z"),
      expiresAtEstimated: true,
    });
  });

  it("pulls a later real best-before date in to the opened date", () => {
    const expiresAt = new Date("2026-10-09T00:00:00Z");
    expect(openedExpiryUpdate({ expiresAt, expiresAtEstimated: false }, 3, now)).toEqual({
      openedAt: now,
      expiresAt: new Date("2026-09-28T10:00:00Z"),
      expiresAtEstimated: true,
    });
  });

  it("keeps an earlier existing date and its flag untouched", () => {
    const expiresAt = new Date("2026-09-26T00:00:00Z");
    expect(openedExpiryUpdate({ expiresAt, expiresAtEstimated: false }, 3, now)).toEqual({
      openedAt: now,
      expiresAt,
      expiresAtEstimated: false,
    });
    expect(openedExpiryUpdate({ expiresAt, expiresAtEstimated: true }, 3, now)?.expiresAtEstimated).toBe(true);
  });

  it("keeps the existing date when it ties with the opened date", () => {
    const expiresAt = new Date("2026-09-28T10:00:00Z");
    expect(openedExpiryUpdate({ expiresAt, expiresAtEstimated: false }, 3, now)).toEqual({
      openedAt: now,
      expiresAt,
      expiresAtEstimated: false,
    });
  });
});

describe("openedResetOnArrival", () => {
  const openedAt = new Date("2026-09-20T10:00:00Z");

  it("does nothing for an item that was never opened", () => {
    expect(openedResetOnArrival({ openedAt: null, expiresAtEstimated: true }, 0, 2)).toBeNull();
    expect(openedResetOnArrival({ expiresAtEstimated: true }, 0, 2)).toBeNull();
  });

  it("keeps an opened item opened when stock is topped up without running out", () => {
    expect(openedResetOnArrival({ openedAt, expiresAtEstimated: true }, 1, 2)).toBeNull();
  });

  it("keeps it opened when no stock actually arrives", () => {
    expect(openedResetOnArrival({ openedAt, expiresAtEstimated: true }, 0, 0)).toBeNull();
  });

  it("clears openedAt and the old pack's estimated date when restocked from zero", () => {
    expect(openedResetOnArrival({ openedAt, expiresAtEstimated: true }, 0, 1)).toEqual({
      openedAt: null,
      expiresAt: null,
      expiresAtEstimated: false,
    });
  });

  it("clears openedAt but leaves a real date alone when restocked from zero", () => {
    expect(openedResetOnArrival({ openedAt, expiresAtEstimated: false }, 0, 1)).toEqual({ openedAt: null });
  });
});

describe("frozenExpiryUpdate (GAP-44)", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("defaults to 90 days from now, flagged as an estimate", () => {
    expect(DEFAULT_USE_WITHIN_DAYS_FROZEN).toBe(90);
    expect(frozenExpiryUpdate(null, now)).toEqual({
      frozenAt: now,
      expiresAt: new Date(now.getTime() + 90 * DAY_MS),
      expiresAtEstimated: true,
    });
  });

  it("uses the item's own window when it has one", () => {
    expect(frozenExpiryUpdate(30, now).expiresAt).toEqual(new Date(now.getTime() + 30 * DAY_MS));
  });

  it("falls back to the default for a non-positive or fractional window", () => {
    for (const bad of [0, -5, 1.5]) {
      expect(frozenExpiryUpdate(bad, now).expiresAt).toEqual(new Date(now.getTime() + 90 * DAY_MS));
    }
  });
});

describe("frozenResetOnArrival (GAP-44)", () => {
  const frozenAt = new Date("2026-09-20T10:00:00Z");

  it("does nothing for an item that was never frozen", () => {
    expect(frozenResetOnArrival({ frozenAt: null, expiresAtEstimated: true }, 0, 2)).toBeNull();
  });

  it("keeps a frozen item frozen when topped up without running out", () => {
    expect(frozenResetOnArrival({ frozenAt, expiresAtEstimated: true }, 1, 2)).toBeNull();
  });

  it("clears frozenAt and the estimated date when restocked from zero", () => {
    expect(frozenResetOnArrival({ frozenAt, expiresAtEstimated: true }, 0, 1)).toEqual({
      frozenAt: null,
      expiresAt: null,
      expiresAtEstimated: false,
    });
  });

  it("leaves a real date alone when restocked from zero", () => {
    expect(frozenResetOnArrival({ frozenAt, expiresAtEstimated: false }, 0, 1)).toEqual({ frozenAt: null });
  });
});
