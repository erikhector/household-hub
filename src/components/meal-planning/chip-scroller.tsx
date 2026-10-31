"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";

// Week picks: one row of chips that scrolls sideways (the planner's tray on
// a phone, and "From this week's picks" in a day's add-meal sheet), so the
// tray stays one row tall however many meals are picked. Three cues say
// there's more: the edge fades, the arrow buttons and a small thumb on a
// track underneath (hidden when everything fits). The arrows are the tap
// path for the swipe (DESIGN.md M7) and 44 px (M3); they only show when
// there is more in their direction.
//
// `wrapFromSm` lets the row wrap from `sm` up instead, where there's room
// (the tray on a tablet or desktop): no scrolling, no arrows, no track.
// `count` (the number of chips) scrolls the row to its end whenever it goes
// up, so a meal just picked comes into view where it was added; a chip
// leaving doesn't move the row.
export function ChipScroller({
  label,
  prevLabel,
  nextLabel,
  wrapFromSm = false,
  count,
  className,
  children,
}: {
  /** Names the list for screen readers ("Picks"). */
  label: string;
  prevLabel: string;
  nextLabel: string;
  wrapFromSm?: boolean;
  count?: number;
  className?: string;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ overflows: false, canPrev: false, canNext: false, thumb: 1, offset: 0 });

  const sync = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const max = row.scrollWidth - row.clientWidth;
    // RTL isn't a locale here, so scrollLeft only runs 0 → max.
    const left = row.scrollLeft;
    const thumb = row.scrollWidth > 0 ? Math.max(row.clientWidth / row.scrollWidth, 0.2) : 1;
    const next = {
      overflows: max > 2,
      canPrev: left > 2,
      canNext: left < max - 2,
      thumb,
      offset: max > 0 ? (left / max) * (1 - thumb) : 0,
    };
    setState((prev) =>
      prev.overflows === next.overflows &&
      prev.canPrev === next.canPrev &&
      prev.canNext === next.canNext &&
      Math.abs(prev.thumb - next.thumb) < 0.005 &&
      Math.abs(prev.offset - next.offset) < 0.005
        ? prev
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    sync();
  });

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(sync);
    observer.observe(row);
    return () => observer.disconnect();
  }, [sync]);

  // A new pick lands at the end of the row: bring it into view. Not on the
  // first render (the tray opens at its start) and not when one leaves.
  const lastCount = useRef(count);
  useEffect(() => {
    const grew = count !== undefined && lastCount.current !== undefined && count > lastCount.current;
    lastCount.current = count;
    const row = rowRef.current;
    if (grew && row) row.scrollTo({ left: row.scrollWidth, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [count]);

  function scrollBy(direction: -1 | 1) {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * 0.75, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  const fadeLeft = state.canPrev ? "3.5rem" : "0px";
  const fadeRight = state.canNext ? "3.5rem" : "0px";
  // Only while the row overflows: a mask also clips what spills past the
  // row's box, like a chip's focus ring or hover lift.
  const mask = state.overflows
    ? `linear-gradient(to right, transparent 0, #000 ${fadeLeft}, #000 calc(100% - ${fadeRight}), transparent 100%)`
    : undefined;

  return (
    <div className={cn("relative min-w-0", className)}>
      <div
        ref={rowRef}
        role="list"
        aria-label={label}
        onScroll={sync}
        // A chip reached with Tab that sits half under a fade scrolls fully
        // into view.
        onFocus={(event) => {
          if (event.target !== rowRef.current) event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
        }}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className={cn(
          // py-1: room for a chip's 3 px focus ring and 1 px hover lift,
          // which a scrolling row would otherwise clip.
          "flex snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          wrapFromSm && "sm:flex-wrap sm:overflow-visible",
        )}
      >
        {children}
      </div>
      {/* Out of the tab order: a keyboard already scrolls the row by moving
          focus along the chips, so these are only for a finger. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={prevLabel}
        // Hidden from everyone while there's nothing that way.
        aria-hidden={!state.canPrev || undefined}
        inert={!state.canPrev}
        onClick={() => scrollBy(-1)}
        className={cn(
          "absolute top-1 left-1 z-10 flex size-11 items-center justify-center rounded-full bg-popover text-foreground shadow-popover ring-1 ring-foreground/10 transition-[opacity,scale] duration-(--motion-duration-base) ease-out active:scale-95",
          state.canPrev ? "opacity-100" : "pointer-events-none scale-90 opacity-0",
          wrapFromSm && "sm:hidden",
        )}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={nextLabel}
        // Hidden from everyone while there's nothing that way.
        aria-hidden={!state.canNext || undefined}
        inert={!state.canNext}
        onClick={() => scrollBy(1)}
        className={cn(
          "absolute top-1 right-1 z-10 flex size-11 items-center justify-center rounded-full bg-popover text-foreground shadow-popover ring-1 ring-foreground/10 transition-[opacity,scale] duration-(--motion-duration-base) ease-out active:scale-95",
          state.canNext ? "opacity-100" : "pointer-events-none scale-90 opacity-0",
          wrapFromSm && "sm:hidden",
        )}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
      {state.overflows && (
        <div aria-hidden="true" className={cn("mx-auto mt-2 h-1 w-16 overflow-hidden rounded-full bg-muted", wrapFromSm && "sm:hidden")}>
          <span
            className="block h-full rounded-full bg-primary/70"
            style={{ width: `${state.thumb * 100}%`, transform: `translateX(${(state.offset / state.thumb) * 100}%)` }}
          />
        </div>
      )}
    </div>
  );
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
