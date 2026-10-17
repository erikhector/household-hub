"use client";

// UX-37 — shopping mode as a tool: the progress ring and the thumb-zone
// "Next up" dock. ShoppingListClient owns the state (which rows are ticked,
// optimistically) and hands these the numbers; the pure parts are in
// src/lib/shopping/shopping-progress.ts.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Circle, CircleCheck } from "lucide-react";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { NextUp, ShoppingProgress } from "@/lib/shopping/shopping-progress";
import { useUnitLabel } from "@/components/units-provider";
import { formatShoppingItemLabel } from "@/lib/shopping-list-text";
import { cn } from "@/lib/utils";

type ShoppingModeDict = Dictionary["shoppingList"]["shoppingMode"];

// The ring's geometry in its own 48-unit viewBox; the rendered size comes
// from the className, so the same ring works in the dock and, larger, in
// the all-done moment.
const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * "12 of 18" as a ring that fills clockwise from twelve o'clock. A real
 * progressbar for screen readers (valuetext is the same "12 of 18" the
 * sighted user reads beside it), so it never relies on the arc alone.
 * The arc's growth is a transition, which globals.css flattens to instant
 * under prefers-reduced-motion.
 */
export function ProgressRing({
  progress,
  dict,
  className,
  children,
}: {
  progress: ShoppingProgress;
  dict: ShoppingModeDict;
  className?: string;
  /** Drawn in the ring's centre, e.g. the all-done tick. */
  children?: ReactNode;
}) {
  return (
    <div
      role="progressbar"
      aria-label={dict.progressAriaLabel}
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.done}
      aria-valuetext={format(dict.progress, { done: progress.done, total: progress.total })}
      className={cn("relative grid size-12 shrink-0 place-items-center", className)}
    >
      <svg viewBox="0 0 48 48" aria-hidden className="absolute inset-0 size-full -rotate-90">
        <circle cx="24" cy="24" r={RADIUS} fill="none" strokeWidth="5" className="stroke-foreground/10" />
        <circle
          cx="24"
          cy="24"
          r={RADIUS}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          // A zero-length round-capped arc still paints a dot; hide it at 0.
          strokeDashoffset={CIRCUMFERENCE * (1 - progress.fraction)}
          className={cn("stroke-primary transition-[stroke-dashoffset] duration-500", progress.done === 0 && "opacity-0")}
        />
      </svg>
      {children}
    </div>
  );
}

// How long a ticked dock row stays as a filled check before the next item
// moves up (UX-78); longer than a double tap's gap (400 ms).
const SETTLE_MS = 450;

type DockItem = { id: string; name: string; quantity: number; unit: string };

/**
 * The thumb-zone dock: pinned to the bottom of a phone's screen (above the
 * BottomNav; sticky at the bottom of the column from sm), it shows the progress ring and the aisle the shopper
 * is in now, with that aisle's next few items as big full-width tap rows.
 * Ticking one here is the same optimistic tick as the row's own checkbox
 * (DESIGN.md M5: the row leaves at once, the ring moves), and finishing an
 * aisle brings the next aisle's items into the dock, so a whole trip can
 * be ticked off with the thumb without scrolling back up. Every row it
 * offers is also in the list above with its own checkbox (M7: nothing is
 * dock-only).
 */
export function NextUpDock<T extends DockItem>({
  next,
  progress,
  dict,
  onTick,
}: {
  next: NextUp<T>;
  progress: ShoppingProgress;
  dict: ShoppingModeDict;
  onTick: (item: T) => void;
}) {
  const unitLabel = useUnitLabel();

  // UX-78: a ticked row leaves the dock within about 60 ms and the next item
  // slides under the same finger, so a double tap ticked two things. The
  // ticked row now stays for SETTLE_MS as a filled check, in its own slot,
  // and every dock row is disabled meanwhile, so the second tap of a double
  // tap lands on nothing. The tick itself is still instant (the ring moves,
  // the list row is ticked); only the dock's copy lingers. The slot count is
  // held, so the item that moves up waits at the end instead of shifting the
  // dock's height.
  const [settling, setSettling] = useState<{ item: T; index: number; count: number } | null>(null);
  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(null), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling]);
  const tick = (item: T, index: number) => {
    if (settling) return;
    setSettling({ item, index, count: next.items.length });
    onTick(item);
  };
  // Minus the ticked row itself: a failed save rolls it back into next.items
  // while it still lingers, and a row must not appear twice.
  const rows: { item: T; ticked: boolean }[] = next.items
    .filter((item) => item.id !== settling?.item.id)
    .map((item) => ({ item, ticked: false }));
  if (settling) {
    rows.splice(settling.index, 0, { item: settling.item, ticked: true });
    rows.length = Math.min(rows.length, settling.count);
  }

  // Phones pin the dock to the bottom of the screen (below), out of the
  // page flow, so a spacer the dock's own height holds its room at the end
  // of the list: the last rows can still scroll up clear of it.
  const dockRef = useRef<HTMLElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    // --shopping-dock on main: the room a just-added row's scrollIntoView
    // has to leave below it (the rows' scroll-margin in
    // shopping-list-client.tsx), since main's scroll-padding only clears the
    // BottomNav and the fixed dock sits above that. 0.5rem is the dock's
    // gap above the bar.
    const main = dock.closest("main");
    const observer = new ResizeObserver(() => {
      setDockHeight(dock.offsetHeight);
      main?.style.setProperty("--shopping-dock", `calc(${dock.offsetHeight}px + 0.5rem)`);
    });
    observer.observe(dock);
    return () => {
      observer.disconnect();
      main?.style.removeProperty("--shopping-dock");
    };
  }, []);

  return (
    <>
      <div aria-hidden className="sm:hidden print:hidden" style={{ height: dockHeight }} />
      <section
        ref={dockRef}
        aria-label={dict.nextUp}
        className={cn(
          "z-30 flex flex-col gap-2 rounded-xl bg-card p-3 shadow-lg ring-1 ring-foreground/10 print:hidden",
          // Phones: fixed just above the BottomNav (z-40; its 3.75rem + safe
          // area, the dashboard layout's matching pb-[…]), inside main's
          // side gutters — always in the thumb zone however short the list
          // has got. Sticky would ride up with a short list. From sm (a
          // sidebar layout, not one-handed) it's sticky at the bottom of the
          // column instead.
          "max-sm:fixed max-sm:right-[max(1rem,env(safe-area-inset-right))] max-sm:bottom-[calc(3.75rem+min(2.125rem,env(safe-area-inset-bottom))+0.5rem)] max-sm:left-[max(1rem,env(safe-area-inset-left))]",
          "sm:sticky sm:bottom-4",
        )}
      >
        <div className="flex items-center gap-3">
          <ProgressRing progress={progress} dict={dict} />
          <div className="min-w-0 flex-1">
            {/* "+N more" rides on this line, not in a footer of its own:
                the dock is pinned by its bottom edge, so a footer that
                appears when the server confirms a just-added fourth row
                (often past the 500 ms CLS grace) would push the dock's top
                up by a line, a late layout shift (MAINT-18). */}
            <span className="block truncate text-xs text-muted-foreground">
              {dict.nextUp}
              {next.more > 0 && (
                <span className="short:hidden">
                  {" · "}
                  {format(plural(next.more, dict.moreHere), { count: next.more })}
                </span>
              )}
            </span>
            {/* A span, not a <p>: the list's own group header is the <p>
                that names the aisle. */}
            <span className="block truncate font-heading text-base font-semibold">{next.label}</span>
          </div>
          {/* The progressbar already says this to a screen reader. */}
          <span aria-hidden className="shrink-0 text-sm font-semibold tabular-nums">
            {format(dict.progress, { done: progress.done, total: progress.total })}
          </span>
        </div>
        {/* A short (landscape phone) screen gets the one next item, not three,
            so the dock never covers most of it. */}
        <ul className="flex flex-col gap-2 short:[&>li:nth-child(n+2)]:hidden">
          {rows.map(({ item, ticked }, index) => {
            const text = formatShoppingItemLabel(item, unitLabel);
            return (
              // Keyed by row, so the item that slides up into a freed slot
              // eases in rather than the slot just changing its text.
              <li key={item.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
                <button
                  type="button"
                  onClick={() => tick(item, index)}
                  disabled={settling !== null}
                  aria-label={ticked ? text : format(dict.tickAriaLabel, { item: text })}
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg bg-muted px-3 py-2 text-left text-lg font-medium transition-[transform,background-color] hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98] disabled:opacity-100"
                >
                  {ticked ? (
                    <CircleCheck aria-hidden className="size-6 shrink-0 fill-primary text-primary-foreground" />
                  ) : (
                    <Circle aria-hidden className="size-6 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 break-words">{text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
