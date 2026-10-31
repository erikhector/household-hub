"use client";

import { useSyncExternalStore, type DragEvent } from "react";
import { GripVertical, History, Plus, Shuffle, X } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChipScroller } from "@/components/meal-planning/chip-scroller";
import { format, plural } from "@/lib/i18n/format";
import type { WeekPickData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type WeekPicksDict = Dictionary["mealPlanning"]["weekPicks"];

// Week picks (REQUIREMENTS.md, "Week picks"): the planner's "Picked for this
// week" tray above the days, holding meals chosen for the week but not on a
// day yet. The planner (WeekPlanner) owns the picks and every action; this
// file draws the tray and its chips.

/**
 * Whether the planner offers drag and drop and the click-to-lift path: a
 * fine pointer at `sm` and up (a desktop or a laptop). A touch screen gets
 * the place sheet on tap instead, whatever its width, since a drag there
 * would fight the page's scroll. False on the server and in the first
 * render, so hydration matches and the sheet is the default.
 */
const POINTER_QUERY = "(min-width: 40rem) and (pointer: fine)";
export function usePointerPlanning(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(POINTER_QUERY);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(POINTER_QUERY).matches,
    () => false,
  );
}

/** One pick as a chip: its name and portions, dashed when carried over. */
export function PickChip({
  pick,
  dict,
  onClick,
  pressed,
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  pick: WeekPickData;
  dict: WeekPicksDict;
  onClick: () => void;
  /** Set on a desktop chip: lifted or not (click-to-lift). */
  pressed?: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
}) {
  return (
    <div role="listitem" data-flip-key={pick.id} className="flex max-w-[78%] shrink-0 snap-start sm:max-w-full">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        draggable={draggable || undefined}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={cn(
          "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border bg-card py-1.5 pr-3 pl-3.5 text-left text-sm font-semibold outline-none transition-[translate,scale,border-color,box-shadow] duration-150 hover:-translate-y-px hover:border-input focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90",
          pick.carried && "border-dashed border-input",
          pressed && "border-primary ring-2 ring-primary/40",
          draggable && "cursor-grab active:cursor-grabbing",
        )}
      >
        {draggable && <GripVertical className="-ml-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        {pick.carried && <History className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="min-w-0 truncate">{pick.name}</span>
        {pick.recipeId && (
          <span className="shrink-0 text-xs font-medium whitespace-nowrap text-muted-foreground">
            {format(plural(pick.portions, dict.portionsShort), { count: pick.portions })}
          </span>
        )}
        {pick.carried && <span className="sr-only">, {dict.carriedLabel}</span>}
      </button>
    </div>
  );
}

export function WeekPicksTray({
  dict,
  picks,
  weekHasMeals,
  canSpread,
  pointer,
  lifted,
  draggingEntry,
  dropActive,
  onPickClick,
  onPickDragStart,
  onDragEnd,
  onOpenPicker,
  onOpenSpread,
  onMoreOptions,
  onCancelLift,
  onTrayDragOver,
  onTrayDragLeave,
  onTrayDrop,
}: {
  dict: WeekPicksDict;
  picks: WeekPickData[];
  /** The week has any meal on a day ("Every pick is on a day."). */
  weekHasMeals: boolean;
  /** Some dinner from today on is free, so Spread has somewhere to put picks. */
  canSpread: boolean;
  /** Desktop: chips lift on click and drag (usePointerPlanning). */
  pointer: boolean;
  lifted: WeekPickData | null;
  /** A planned meal is being dragged, so the tray is a drop target. */
  draggingEntry: boolean;
  dropActive: boolean;
  onPickClick: (pick: WeekPickData) => void;
  onPickDragStart: (pick: WeekPickData, event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onOpenPicker: () => void;
  onOpenSpread: () => void;
  onMoreOptions: (pick: WeekPickData) => void;
  onCancelLift: () => void;
  onTrayDragOver: (event: DragEvent<HTMLElement>) => void;
  onTrayDragLeave: (event: DragEvent<HTMLElement>) => void;
  onTrayDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const count = picks.length;
  return (
    <section
      aria-labelledby="week-picks-title"
      onDragOver={onTrayDragOver}
      onDragLeave={onTrayDragLeave}
      onDrop={onTrayDrop}
      className={cn(
        "list-bleed flex flex-col gap-3 rounded-xl bg-[color-mix(in_oklch,var(--card)_70%,var(--accent))] p-4 ring-1 ring-primary/20 transition-shadow",
        dropActive && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="week-picks-title" className="flex items-center gap-2 text-base font-semibold">
          {dict.trayTitle}
          {count > 0 && <Badge variant="secondary">{count}</Badge>}
        </h2>
        {(count > 0 || weekHasMeals) && (
          <Button type="button" variant="ghost" onClick={onOpenPicker}>
            <Plus className="size-4" aria-hidden="true" />
            {count > 0 ? dict.pickMeals : dict.pickMore}
          </Button>
        )}
      </div>

      {count === 0 ? (
        weekHasMeals ? (
          // M6: collapsed to one line once every pick is on a day.
          <p className="-mt-2 text-sm text-muted-foreground">{draggingEntry ? dict.dropOnTray : dict.allPlaced}</p>
        ) : (
          <>
            <p className="-mt-1 text-sm text-muted-foreground">{dict.emptyHint}</p>
            <Button type="button" variant="outline" className="w-full sm:w-auto sm:self-start" onClick={onOpenPicker}>
              <Plus className="size-4" aria-hidden="true" />
              {dict.pickMeals}
            </Button>
          </>
        )
      ) : (
        <>
          <p className="-mt-1 text-sm text-muted-foreground">
            {draggingEntry ? dict.dropOnTray : pointer ? dict.trayHintPointer : dict.trayHintTouch}
          </p>
          {/* The chips scroll sideways on a phone and wrap from `sm`. They
              bleed to the card's edges on a phone, so a chip slides out
              under the fade rather than stopping short of it. */}
          <ChipScroller
            label={dict.listLabel}
            prevLabel={dict.scrollPrev}
            nextLabel={dict.scrollNext}
            wrapFromSm
            endKey={count}
            className="max-sm:-mx-4 max-sm:[&>[role=list]]:px-4 max-sm:[&>[role=list]]:scroll-px-4"
          >
            {picks.map((pick) => (
              <PickChip
                key={pick.id}
                pick={pick}
                dict={dict}
                pressed={pointer ? lifted?.id === pick.id : undefined}
                draggable={pointer}
                onClick={() => onPickClick(pick)}
                onDragStart={(event) => onPickDragStart(pick, event)}
                onDragEnd={onDragEnd}
              />
            ))}
          </ChipScroller>
          {lifted ? (
            // Click-to-lift (desktop, M7's tap path for the drag): the pick
            // waits for a day's "Place here". Escape cancels too.
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 font-medium break-words">
                {format(dict.liftedHint, { name: lifted.name })}
              </span>
              <Button type="button" variant="ghost" onClick={() => onMoreOptions(lifted)}>
                {dict.moreOptions}
              </Button>
              <Button type="button" variant="ghost" onClick={onCancelLift}>
                <X className="size-4" aria-hidden="true" />
                {dict.cancel}
              </Button>
            </div>
          ) : (
            canSpread && (
              <Button type="button" variant="secondary" className="w-full sm:w-auto sm:self-start" onClick={onOpenSpread}>
                <Shuffle className="size-4" aria-hidden="true" />
                {dict.spread}
              </Button>
            )
          )}
        </>
      )}
    </section>
  );
}
