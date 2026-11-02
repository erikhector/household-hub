import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { toDiscoverContext } from "./pantry";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-02T12:00:00Z").getTime();

describe("toDiscoverContext", () => {
  it("flags expired and soon-to-expire items as expiring, and passes the rest through", () => {
    const context = toDiscoverContext(
      [
        { name: "Milk", quantity: 1, expiresAt: new Date(NOW - DAY_MS) },
        { name: "Spinach", quantity: 2, expiresAt: new Date(NOW + 2 * DAY_MS) },
        { name: "Rice", quantity: 3, expiresAt: new Date(NOW + 30 * DAY_MS) },
        { name: "Salt", quantity: 0, expiresAt: null },
      ],
      ["Pancakes", "Tacos"],
      NOW,
    );
    expect(context.pantry).toEqual([
      { name: "Milk", quantity: 1, expiring: true },
      { name: "Spinach", quantity: 2, expiring: true },
      { name: "Rice", quantity: 3, expiring: false },
      { name: "Salt", quantity: 0, expiring: false },
    ]);
    expect(context.savedNames).toEqual(["Pancakes", "Tacos"]);
  });

  it("returns empty lists for an empty household", () => {
    expect(toDiscoverContext([], [], NOW)).toEqual({ pantry: [], savedNames: [] });
  });
});
