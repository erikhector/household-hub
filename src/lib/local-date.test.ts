// The helper depends on the process timezone, so each case pins TZ (Node
// re-reads it on assignment) and restores it afterwards.
import { afterEach, describe, expect, it, vi } from "vitest";
import { toLocalDateKey, todayLocalDateKey } from "@/lib/local-date";

const originalTZ = process.env.TZ;

function inTZ(tz: string, fn: () => void) {
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
}

afterEach(() => vi.useRealTimers());

describe("toLocalDateKey", () => {
  it("keeps 23:30 local on the same day in UTC-5 (UTC is already the next day)", () => {
    inTZ("America/Bogota", () => {
      const d = new Date(2026, 2, 14, 23, 30);
      expect(d.toISOString().slice(0, 10)).toBe("2026-03-15");
      expect(toLocalDateKey(d)).toBe("2026-03-14");
    });
  });

  it("keeps 23:30 local on the same day in UTC+10 (and 00:30, when UTC is still the day before)", () => {
    inTZ("Australia/Brisbane", () => {
      const late = new Date(2026, 2, 15, 23, 30);
      expect(toLocalDateKey(late)).toBe("2026-03-15");
      const early = new Date(2026, 2, 15, 0, 30);
      expect(early.toISOString().slice(0, 10)).toBe("2026-03-14");
      expect(toLocalDateKey(early)).toBe("2026-03-15");
    });
  });

  it("zero-pads month and day", () => {
    inTZ("UTC", () => {
      expect(toLocalDateKey(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
    });
  });
});

describe("todayLocalDateKey", () => {
  it("reads the local day of the current instant", () => {
    inTZ("America/Bogota", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 5, 1, 23, 30));
      expect(todayLocalDateKey()).toBe("2026-06-01");
    });
  });
});
