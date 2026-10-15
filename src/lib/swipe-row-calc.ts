// UX-35: the pure maths behind SwipeRow (src/components/shared/swipe-row.tsx)
// — kept out of the component so it can be unit-tested without a DOM.
//
// A row swipes two ways: right commits its primary action (tick, complete,
// +1) once the finger is past COMMIT_FRACTION of the row's width, and left
// reveals a tray of buttons (Edit, Delete) that stays open once dragged past
// half its width. Everything here is in CSS pixels, positive = rightwards.

/** The screen edges belong to the OS back gesture (DESIGN.md M7). */
export const EDGE_ZONE_PX = 20;
/** How far the finger moves before we decide between swipe and scroll. */
export const AXIS_LOCK_PX = 8;
/** Share of the row's width a right swipe must cross to commit. */
export const COMMIT_FRACTION = 0.4;
/** How much of the finger's travel past a limit still moves the row. */
const RUBBER_BAND = 0.3;

export type SwipeRowGeometry = {
  rowWidth: number;
  trayWidth: number;
  canSwipeRight: boolean;
  canSwipeLeft: boolean;
};

export function isInEdgeZone(clientX: number, viewportWidth: number): boolean {
  return clientX < EDGE_ZONE_PX || clientX > viewportWidth - EDGE_ZONE_PX;
}

/** Null until the finger has moved far enough to tell. A tie goes to the
 * scroll: ticking a row by accident on a sloppy scroll is worse than having
 * to swipe a little straighter. */
export function lockAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

function rubberBand(offset: number, limit: number): number {
  if (Math.abs(offset) <= limit) return offset;
  return Math.sign(offset) * (limit + (Math.abs(offset) - limit) * RUBBER_BAND);
}

/** Where the row sits for a drag of `raw` px from rest. */
export function dragOffset(raw: number, row: SwipeRowGeometry): number {
  if (raw > 0) return row.canSwipeRight ? rubberBand(raw, row.rowWidth) : 0;
  if (raw < 0) return row.canSwipeLeft ? rubberBand(raw, row.trayWidth) : 0;
  return 0;
}

export function releaseOutcome(offset: number, row: SwipeRowGeometry): "commit" | "open" | "close" {
  if (row.canSwipeRight && offset >= row.rowWidth * COMMIT_FRACTION) return "commit";
  if (row.canSwipeLeft && offset <= -row.trayWidth / 2) return "open";
  return "close";
}

/** True on the one move that carries a right swipe over the commit line —
 * the moment for the haptic tick. */
export function crossedCommitThreshold(previous: number, next: number, rowWidth: number): boolean {
  const threshold = rowWidth * COMMIT_FRACTION;
  return previous < threshold && next >= threshold;
}
