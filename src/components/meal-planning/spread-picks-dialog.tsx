"use client";

import { useState } from "react";
import { Shuffle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canShuffle, suggestSpread, type SpreadReason, type Weekday } from "@/lib/week-picks-spread";
import { format, plural } from "@/lib/i18n/format";
import type { WeekPickData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];
type WeekPicksDict = MealPlanningDict["weekPicks"];

const habitKeys = [
  "reasonHabitMon",
  "reasonHabitTue",
  "reasonHabitWed",
  "reasonHabitThu",
  "reasonHabitFri",
  "reasonHabitSat",
  "reasonHabitSun",
] as const satisfies readonly (keyof WeekPicksDict)[];

export type FreeDinner = { weekday: Weekday; dateKey: string; label: string };

function reasonText(dict: WeekPicksDict, reason: SpreadReason): string {
  if (reason.kind === "habit") return dict[habitKeys[reason.weekday]];
  if (reason.kind === "fresh") return format(dict.reasonFresh, { item: reason.item });
  return dict.reasonOrder;
}

// Week picks' "Spread over the week": a preview of a day for every pick,
// each with its reason (suggestSpread in week-picks-spread.ts). Suggest,
// don't mutate (DESIGN.md, User control): nothing is saved until "Place
// all", and the planner's toast then offers one Undo for the lot. Shuffle
// offers another arrangement of the pick-order rows.
export function SpreadPicksDialog({
  dict,
  picks,
  freeDinners,
  onPlaceAll,
  onClose,
}: {
  dict: MealPlanningDict;
  picks: WeekPickData[];
  freeDinners: FreeDinner[];
  onPlaceAll: (rows: { pickId: string; dateKey: string }[]) => void;
  onClose: () => void;
}) {
  const wp = dict.weekPicks;
  const [rotate, setRotate] = useState(0);
  const freeWeekdays = freeDinners.map((d) => d.weekday);
  const { rows, unplaced } = suggestSpread(picks, freeWeekdays, rotate);
  const pickById = new Map(picks.map((pick) => [pick.id, pick]));
  const dayByWeekday = new Map(freeDinners.map((d) => [d.weekday, d]));

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(plural(rows.length, wp.spreadTitle), { count: rows.length })}</DialogTitle>
          <DialogDescription>{wp.spreadHint}</DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-1.5" aria-live="polite">
          {rows.map((row) => (
            <li
              key={`${row.pickId}-${row.weekday}`}
              className="flex min-h-14 items-center gap-3 rounded-lg bg-muted px-3 py-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1"
            >
              <span className="w-14 shrink-0 font-semibold">{dayByWeekday.get(row.weekday)?.label}</span>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium break-words">{pickById.get(row.pickId)?.name}</span>
                <span className="text-xs text-muted-foreground">{reasonText(wp, row.reason)}</span>
              </span>
            </li>
          ))}
        </ul>

        {unplaced > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {format(plural(unplaced, wp.spreadDidntFit), { count: unplaced })}
          </p>
        )}

        <DialogFooter>
          {canShuffle(picks, freeWeekdays) && (
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setRotate((r) => r + 1)}>
              <Shuffle className="size-4" aria-hidden="true" />
              {wp.shuffle}
            </Button>
          )}
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={rows.length === 0}
            onClick={() =>
              onPlaceAll(rows.map((row) => ({ pickId: row.pickId, dateKey: dayByWeekday.get(row.weekday)!.dateKey })))
            }
          >
            {format(plural(rows.length, wp.placeAll), { count: rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
