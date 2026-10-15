import { describe, expect, it } from "vitest";
import {
  hasTicksInFlight,
  NO_TICKS,
  reconcileTicks,
  shownPurchased,
  tickSettled,
  tickStarted,
} from "@/lib/shopping/tick-overlay";

describe("tick overlay", () => {
  it("shows a tick at once and keeps it until the server agrees", () => {
    let overlay = tickStarted(NO_TICKS, "a", false);
    expect(shownPurchased(overlay, "a", false)).toBe(true);
    expect(hasTicksInFlight(overlay)).toBe(true);

    // Saved, but the revalidated list hasn't arrived: still ticked.
    overlay = tickSettled(overlay, "a", true, false);
    expect(shownPurchased(overlay, "a", false)).toBe(true);
    expect(hasTicksInFlight(overlay)).toBe(false);

    // The server's list now says purchased: the entry goes.
    overlay = reconcileTicks(overlay, [{ id: "a", purchased: true }]);
    expect(overlay.size).toBe(0);
  });

  it("rolls a failed tick back at once while another tick is still in flight", () => {
    let overlay = tickStarted(NO_TICKS, "slow", false);
    overlay = tickStarted(overlay, "failing", false);

    overlay = tickSettled(overlay, "failing", false, false);
    expect(shownPurchased(overlay, "failing", false)).toBe(false);
    expect(overlay.has("failing")).toBe(false);
    // The slow one is untouched and still in flight.
    expect(shownPurchased(overlay, "slow", false)).toBe(true);
    expect(hasTicksInFlight(overlay)).toBe(true);
  });

  it("treats a quick re-tap as two toggles that cancel out", () => {
    let overlay = tickStarted(NO_TICKS, "a", false);
    overlay = tickStarted(overlay, "a", false);
    expect(shownPurchased(overlay, "a", false)).toBe(false);
    overlay = tickSettled(overlay, "a", true, true);
    expect(hasTicksInFlight(overlay)).toBe(true);
    overlay = tickSettled(overlay, "a", true, false);
    expect(overlay.size).toBe(0);
  });

  it("undoes only the failed half of a re-tap", () => {
    let overlay = tickStarted(NO_TICKS, "a", false); // tick
    overlay = tickStarted(overlay, "a", false); // untick
    overlay = tickSettled(overlay, "a", true, false); // tick saved
    overlay = tickSettled(overlay, "a", false, false); // untick failed
    expect(shownPurchased(overlay, "a", false)).toBe(true);
    overlay = reconcileTicks(overlay, [{ id: "a", purchased: true }]);
    expect(overlay.size).toBe(0);
  });

  it("lets the server win once settled, even when it disagrees", () => {
    // Saved as ticked, then someone else unticked it before the
    // revalidated list arrived: that list is the truth.
    let overlay = tickSettled(tickStarted(NO_TICKS, "a", false), "a", true, false);
    expect(shownPurchased(overlay, "a", false)).toBe(true);
    overlay = reconcileTicks(overlay, [{ id: "a", purchased: false }]);
    expect(overlay.size).toBe(0);
    expect(shownPurchased(overlay, "a", false)).toBe(false);
  });

  it("settles after its revalidated list has already rendered", () => {
    // The new list lands while the save is still counted in flight: kept.
    let overlay = tickStarted(NO_TICKS, "a", false);
    overlay = reconcileTicks(overlay, [{ id: "a", purchased: true }]);
    expect(shownPurchased(overlay, "a", true)).toBe(true);
    expect(overlay.size).toBe(1);
    // Settling against that (current) list drops it at once.
    expect(tickSettled(overlay, "a", true, true).size).toBe(0);

    // If the current list disagrees by then, the entry holds only until
    // the next list, which wins.
    let held = tickStarted(NO_TICKS, "b", false);
    held = reconcileTicks(held, [{ id: "b", purchased: false }]);
    held = tickSettled(held, "b", true, false);
    expect(shownPurchased(held, "b", false)).toBe(true);
    held = reconcileTicks(held, [{ id: "b", purchased: false }]);
    expect(held.size).toBe(0);
  });

  it("drops a settled entry for a row that's gone, and ignores unknown ids", () => {
    let overlay = tickSettled(tickStarted(NO_TICKS, "a", false), "a", true, false);
    overlay = reconcileTicks(overlay, []);
    expect(overlay.size).toBe(0);
    expect(tickSettled(NO_TICKS, "x", true, false)).toBe(NO_TICKS);
  });
});
