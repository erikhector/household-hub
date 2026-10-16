"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  crossedCommitThreshold,
  dragOffset,
  isInEdgeZone,
  lockAxis,
  releaseOutcome,
  type SwipeRowGeometry,
} from "@/lib/swipe-row-calc";

/** w-18, the width of each tray button. */
const TRAY_BUTTON_PX = 72;
/** gap-2 between them: M3's 8 px between neighbouring targets, so a thumb
 * aimed at Edit doesn't land on Delete. */
const TRAY_GAP_PX = 8;

// UX-35: Todoist-style swipe actions on a list row, for touch only.
//   - Swipe right past 40% of the row: its primary action (tick, complete,
//     +1). Android gets a 10 ms buzz as the swipe crosses that line; iOS has
//     no vibrate API, so the coloured underlay filling in is the signal.
//   - Swipe left: a tray with Edit and Delete stays open until a tap
//     elsewhere.
//
// Every gesture duplicates a button the row already has (DESIGN.md M7; on a
// phone that button may sit behind the row's ⋯, RowActionsMenu, rather than
// show as a second icon), so rather than take callbacks this clicks those
// buttons: the row's element
// marked `data-swipe-primary` and `data-swipe-edit`. That reuses each one's
// own handler, its optimistic update and rollback, and its disabled state,
// and the Edit dialogs need no open/close plumbing (the same trick
// ItemActions uses for its menu's Delete). The tray only exists while it's
// showing, so a list doesn't carry a second Edit and Delete per row.
//
// Mouse and pen are ignored, so desktop behaves as before. `touch-pan-y`
// leaves vertical scrolling to the browser until the swipe has locked
// sideways; from then on the page doesn't scroll under it (see the
// touchmove effect). A swipe that starts in the 20 px screen edges is left
// to the OS back gesture. Under reduced motion
// the global rule in globals.css makes the snap-back instant.
export function SwipeRow({
  children,
  primaryLabel,
  primaryIcon,
  editLabel,
  deleteLabel,
  onDelete,
  disabled = false,
  className,
  flipKey,
  inert = false,
}: {
  children: ReactNode;
  /** Shown under the row on a right swipe; omit to turn right swipes off. */
  primaryLabel?: string;
  primaryIcon?: ReactNode;
  /** Omit (with deleteLabel) to turn left swipes off. */
  editLabel?: string;
  deleteLabel?: string;
  onDelete?: () => void;
  disabled?: boolean;
  /** Corner radius etc., to match the row it wraps. */
  className?: string;
  /** The row's key for useFlipList (UX-33): this is the element that moves
   * when the list does. */
  flipKey?: string;
  /** The row is a fading leftover copy of one that has already moved
   * elsewhere (MAINT-19): inert takes it out of the tab order and
   * clicks, and aria-hidden out of the accessibility tree (some engines,
   * Playwright's role queries among them, don't treat inert as hidden), so
   * the item is exposed once, not twice. */
  inert?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; base: number; axis: "x" | "y" | null; offset: number } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const ownClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);

  const canSwipeRight = primaryLabel !== undefined;
  const canSwipeLeft = editLabel !== undefined || onDelete !== undefined;
  // Fixed, not measured: the tray isn't rendered until the row moves.
  const trayButtons = (editLabel !== undefined ? 1 : 0) + (onDelete ? 1 : 0);
  const trayWidth = trayButtons * TRAY_BUTTON_PX + Math.max(trayButtons - 1, 0) * TRAY_GAP_PX;

  function geometry(): SwipeRowGeometry {
    return {
      rowWidth: rootRef.current?.offsetWidth ?? 0,
      trayWidth,
      canSwipeRight,
      canSwipeLeft,
    };
  }

  function close() {
    setOpen(false);
    setOffset(0);
  }

  // An open tray closes on any touch outside the row — including the start
  // of a scroll, so it never rides along off screen.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Once a drag has locked sideways the page must not scroll under it.
  // `touch-pan-y` alone doesn't promise that: a finger that drifts down
  // mid-swipe can still scroll the list (iOS Safari especially), which
  // moved the row out from under the thumb and sometimes cancelled the
  // swipe outright. Cancelling touchmove stops it, but only from a native,
  // non-passive listener: React's touch handlers are passive. Pointer
  // events fire before touch events, so `axis` is already set by the time
  // this runs; until it is, the browser keeps the scroll.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const onTouchMove = (event: TouchEvent) => {
      if (drag.current?.axis === "x" && event.cancelable) event.preventDefault();
    };
    content.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => content.removeEventListener("touchmove", onTouchMove);
  }, []);

  // Our own click on the row's button passes through onClickCapture below,
  // which must let it by whatever state the swipe left behind.
  function clickMarked(selector: string) {
    ownClick.current = true;
    try {
      contentRef.current?.querySelector<HTMLElement>(selector)?.click();
    } finally {
      ownClick.current = false;
    }
  }

  function onPointerDown(event: React.PointerEvent) {
    // A drag that ended without the browser sending a click would otherwise
    // leave this set and eat the next real tap.
    suppressClick.current = false;
    if (event.pointerType !== "touch" || disabled) return;
    if (isInEdgeZone(event.clientX, window.innerWidth)) return;
    const base = open ? -trayWidth : 0;
    drag.current = { startX: event.clientX, startY: event.clientY, base, axis: null, offset: base };
  }

  function onPointerMove(event: React.PointerEvent) {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.startX;
    if (current.axis === null) {
      current.axis = lockAxis(dx, event.clientY - current.startY);
      if (current.axis === null) return;
      if (current.axis === "y") {
        drag.current = null;
        return;
      }
      contentRef.current?.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    const geo = geometry();
    const next = dragOffset(current.base + dx, geo);
    if (geo.canSwipeRight && crossedCommitThreshold(current.offset, next, geo.rowWidth) && "vibrate" in navigator) {
      navigator.vibrate(10);
    }
    current.offset = next;
    setOffset(next);
  }

  function onPointerUp() {
    const current = drag.current;
    drag.current = null;
    if (!current || current.axis !== "x") return;
    setDragging(false);
    const geo = geometry();
    const outcome = releaseOutcome(current.offset, geo);
    if (outcome === "open") {
      setOpen(true);
      setOffset(-trayWidth);
    } else {
      close();
      if (outcome === "commit") clickMarked("[data-swipe-primary]");
    }
    suppressClick.current = true;
  }

  function onPointerCancel() {
    drag.current = null;
    setDragging(false);
    setOffset(open ? -trayWidth : 0);
  }

  // The click a browser may send at the end of a drag must not tick the row
  // (a shopping row's label covers all of it); nor may the tap that closes
  // an open tray.
  function onClickCapture(event: React.MouseEvent) {
    if (ownClick.current) return;
    if (suppressClick.current || open) {
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      if (open) close();
    }
  }

  return (
    <div ref={rootRef} data-swipe-row data-flip-key={flipKey} inert={inert} aria-hidden={inert || undefined} className={cn("relative overflow-hidden", className)}>
      {canSwipeRight && offset > 0 && (
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 flex items-center gap-2 bg-primary px-4 text-sm font-medium text-primary-foreground"
          style={{ width: offset }}
        >
          {primaryIcon}
          <span className="truncate">{primaryLabel}</span>
        </div>
      )}
      {canSwipeLeft && offset < 0 && (
        <div className="absolute inset-y-0 right-0 flex gap-2 bg-background">
          {editLabel !== undefined && (
            <button
              type="button"
              className="flex w-18 flex-col items-center justify-center gap-1 bg-muted text-xs font-medium text-foreground"
              onClick={() => {
                close();
                clickMarked("[data-swipe-edit]");
              }}
            >
              <Pencil className="size-4" />
              {editLabel}
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="flex w-18 flex-col items-center justify-center gap-1 bg-destructive/15 text-xs font-medium text-destructive dark:bg-destructive/25"
              onClick={() => {
                close();
                onDelete();
              }}
            >
              <Trash2 className="size-4" />
              {deleteLabel}
            </button>
          )}
        </div>
      )}
      <div
        ref={contentRef}
        className={cn("relative touch-pan-y bg-background", !dragging && "transition-transform duration-200 ease-out")}
        style={offset === 0 ? undefined : { transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
