import { describe, expect, it } from "vitest";
import {
  AXIS_LOCK_PX,
  EDGE_ZONE_PX,
  crossedCommitThreshold,
  dragOffset,
  isInEdgeZone,
  lockAxis,
  releaseOutcome,
} from "./swipe-row-calc";

describe("isInEdgeZone", () => {
  it("leaves the left and right 20 px to the OS back gesture", () => {
    expect(isInEdgeZone(0, 400)).toBe(true);
    expect(isInEdgeZone(EDGE_ZONE_PX - 1, 400)).toBe(true);
    expect(isInEdgeZone(400 - EDGE_ZONE_PX + 1, 400)).toBe(true);
  });

  it("accepts a touch anywhere else", () => {
    expect(isInEdgeZone(EDGE_ZONE_PX, 400)).toBe(false);
    expect(isInEdgeZone(200, 400)).toBe(false);
    expect(isInEdgeZone(400 - EDGE_ZONE_PX, 400)).toBe(false);
  });
});

describe("lockAxis", () => {
  it("waits until the finger has moved past the lock distance", () => {
    expect(lockAxis(AXIS_LOCK_PX - 1, 0)).toBeNull();
    expect(lockAxis(0, -(AXIS_LOCK_PX - 1))).toBeNull();
  });

  it("locks to the axis with the larger movement", () => {
    expect(lockAxis(AXIS_LOCK_PX, 2)).toBe("x");
    expect(lockAxis(-12, 4)).toBe("x");
    expect(lockAxis(3, AXIS_LOCK_PX + 1)).toBe("y");
  });

  it("gives a perfect diagonal to the scroll, so a sloppy scroll never ticks a row", () => {
    expect(lockAxis(10, 10)).toBe("y");
  });
});

describe("dragOffset", () => {
  const row = { rowWidth: 300, trayWidth: 120, canSwipeRight: true, canSwipeLeft: true };

  it("follows the finger inside the limits", () => {
    expect(dragOffset(80, row)).toBe(80);
    expect(dragOffset(-60, row)).toBe(-60);
  });

  it("doesn't move in a direction the row has no action for", () => {
    expect(dragOffset(80, { ...row, canSwipeRight: false })).toBe(0);
    expect(dragOffset(-80, { ...row, canSwipeLeft: false })).toBe(0);
  });

  it("rubber-bands past the open tray", () => {
    const pastTray = dragOffset(-220, row);
    expect(pastTray).toBeLessThan(-120);
    expect(pastTray).toBeGreaterThan(-220);
  });

  it("rubber-bands past the row width on a right swipe", () => {
    const pastRow = dragOffset(400, row);
    expect(pastRow).toBeGreaterThan(300);
    expect(pastRow).toBeLessThan(400);
  });
});

describe("releaseOutcome", () => {
  const row = { rowWidth: 300, trayWidth: 120, canSwipeRight: true, canSwipeLeft: true };

  it("commits the primary action past 40% of the row", () => {
    expect(releaseOutcome(120, row)).toBe("commit");
    expect(releaseOutcome(119, row)).toBe("close");
  });

  it("opens the tray past half its width", () => {
    expect(releaseOutcome(-60, row)).toBe("open");
    expect(releaseOutcome(-59, row)).toBe("close");
  });

  it("never commits or opens a direction the row lacks", () => {
    expect(releaseOutcome(250, { ...row, canSwipeRight: false })).toBe("close");
    expect(releaseOutcome(-100, { ...row, canSwipeLeft: false })).toBe("close");
  });
});

describe("crossedCommitThreshold", () => {
  it("fires once, on the move that crosses the threshold outwards", () => {
    expect(crossedCommitThreshold(100, 125, 300)).toBe(true);
    expect(crossedCommitThreshold(125, 140, 300)).toBe(false);
    expect(crossedCommitThreshold(140, 100, 300)).toBe(false);
    expect(crossedCommitThreshold(-10, -200, 300)).toBe(false);
  });
});
