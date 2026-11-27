"use client";

import { useState } from "react";
import { ChefHat, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { format, plural } from "@/lib/i18n/format";
import type { MealPlanEntryData, WeekPickData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

const mealTypeDictKey = {
  BREAKFAST: "mealTypeBreakfast",
  LUNCH: "mealTypeLunch",
  DINNER: "mealTypeDinner",
  SNACK: "mealTypeSnack",
} as const satisfies Record<MealType, keyof MealPlanningDict>;

export type PlaceDay = {
  dateKey: string;
  /** "Mon 2", as the day cards say it. */
  label: string;
  entries: MealPlanEntryData[];
};

// Week picks: a pick's sheet, opened by tapping its chip. Choose the slot
// (dinner preselected, since a pick has none of its own) and a day; each
// day row says what's already in that slot or that it's free, so the free
// evenings stand out. "Mark as cooked today" is for cooking off-plan, and
// "Remove from picks" sits apart at the bottom (M2).
export function PlacePickDialog({
  dict,
  pick,
  days,
  onPlace,
  onMarkCooked,
  onRemove,
  onClose,
}: {
  dict: MealPlanningDict;
  pick: WeekPickData;
  days: PlaceDay[];
  onPlace: (dateKey: string, mealType: MealType, dayLabel: string) => void;
  onMarkCooked: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const wp = dict.weekPicks;
  const [mealType, setMealType] = useState<MealType>("DINNER");
  const slotLabel = dict[mealTypeDictKey[mealType]];
  const meta = [
    pick.recipeId ? format(plural(pick.portions, dict.entryPortionsCount), { count: pick.portions }) : null,
    pick.carriedFromWeek ? wp.carriedLabel : null,
    pick.pickedBy ? format(wp.pickedBy, { name: pick.pickedBy }) : null,
    wp.placeMovable,
  ].filter(Boolean);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="break-words">{format(wp.placeTitle, { name: pick.name })}</DialogTitle>
          <DialogDescription>{meta.join(" · ")}</DialogDescription>
        </DialogHeader>

        {/* UX-214: 14 px labels, never truncated (M9). Four across need
            about 21rem ("Mellanmål"), so a narrower sheet (320 px, or
            larger text) takes them 2×2. A container query in rem, so it
            follows the sheet's width and the reader's text size. */}
        <div className="@container">
          <div
            role="group"
            aria-label={wp.slotLabel}
            className="grid grid-cols-2 gap-0.5 rounded-lg bg-muted p-0.5 @min-[21rem]:grid-cols-4"
          >
            {MEAL_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={type === mealType}
                onClick={() => setMealType(type)}
                className={cn(
                  "min-h-10 break-words rounded-md px-1 text-sm font-semibold text-muted-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:min-h-11 pointer-coarse:min-h-11",
                  type === mealType && "bg-card text-foreground shadow-raised ring-1 ring-foreground/10",
                )}
              >
                {dict[mealTypeDictKey[type]]}
              </button>
            ))}
          </div>
        </div>

        <ul className="flex flex-col gap-0.5">
          {days.map((day) => {
            const there = day.entries.filter((entry) => entry.mealType === mealType);
            return (
              <li key={day.dateKey}>
                <button
                  type="button"
                  onClick={() => onPlace(day.dateKey, mealType, day.label)}
                  className="flex min-h-13 w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
                >
                  <span className="w-14 shrink-0 font-semibold">{day.label}</span>
                  {/* UX-214: what's already in the slot is what you check
                      before doubling up, so every meal shows in full, one
                      per line, wrapping rather than truncated (M9). */}
                  {there.length > 0 ? (
                    <span className="flex min-w-0 flex-1 flex-col gap-1 break-words text-sm text-muted-foreground">
                      {there.map((entry) => (
                        <span key={entry.id}>{entry.recipeName ?? entry.freeformName ?? ""}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 break-words text-sm font-semibold text-success">
                      {format(wp.slotFree, { slot: slotLabel })}
                    </span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>

        {pick.recipeId && (
          <Button type="button" variant="outline" className="justify-start" onClick={onMarkCooked}>
            <ChefHat className="size-4" aria-hidden="true" />
            {wp.markCookedToday}
          </Button>
        )}

        {/* M2: the destructive action sits apart, under a rule. */}
        <div className="border-t pt-4">
          <Button type="button" variant="destructive" className="w-full justify-start" onClick={onRemove}>
            <Trash2 className="size-4" aria-hidden="true" />
            {wp.removeFromPicks}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
