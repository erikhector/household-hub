import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { describeStockEvent, relativeAge } from "@/lib/inventory/stock-history-view";

const now = new Date("2026-11-04T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("relativeAge", () => {
  it("counts days, hours and minutes in the locale", () => {
    expect(relativeAge(daysAgo(2), now, "en")).toBe("2 days ago");
    expect(relativeAge(daysAgo(2), now, "sv")).toBe("för 2 dagar sedan");
    expect(relativeAge(new Date(now.getTime() - 3 * 3_600_000), now, "en")).toBe("3 hours ago");
    expect(relativeAge(new Date(now.getTime() - 5 * 60_000), now, "en")).toBe("5 minutes ago");
  });

  it("falls back to the date beyond a month", () => {
    expect(relativeAge(daysAgo(90), now, "en")).toBe("Aug 6, 2026");
  });
});

describe("describeStockEvent", () => {
  const event = { reason: "used", delta: -1, userName: "Anna", createdAt: daysAgo(2) };

  it("words a decrement like 'Anna used 1 pcs · 2 days ago'", () => {
    expect(describeStockEvent(event, { unit: "pcs", now, locale: "en", dict: en.inventory.itemPage })).toBe(
      "Anna used 1 pcs · 2 days ago",
    );
    expect(describeStockEvent(event, { unit: "st", now, locale: "sv", dict: sv.inventory.itemPage })).toBe(
      "Anna använde 1 st · för 2 dagar sedan",
    );
  });

  it("falls back to 'Someone' for a user who has left", () => {
    const text = describeStockEvent({ ...event, userName: null }, { unit: "pcs", now, locale: "en", dict: en.inventory.itemPage });
    expect(text).toBe("Someone used 1 pcs · 2 days ago");
  });

  it("shows a sign only for an adjustment", () => {
    const options = { unit: "pcs", now, locale: "en", dict: en.inventory.itemPage };
    expect(describeStockEvent({ ...event, reason: "adjusted", delta: -1.5 }, options)).toContain("adjusted by −1.5 pcs");
    expect(describeStockEvent({ ...event, reason: "adjusted", delta: 2 }, options)).toContain("adjusted by +2 pcs");
    expect(describeStockEvent({ ...event, reason: "trip", delta: 3 }, options)).toContain("bought 3 pcs");
    expect(describeStockEvent({ ...event, reason: "cooked", delta: -2 }, options)).toContain("cooked with 2 pcs");
  });
});
