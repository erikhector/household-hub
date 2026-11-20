"use client";

import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddMealSlot } from "@/components/meal-planning/add-meal-slot";
import { MealEntryRow } from "@/components/meal-planning/meal-entry-row";
import type { RecipeCookedStats } from "@/app/dashboard/meal-planning/recipe-cooked-stats";
import type { PlanLeftoversRequest } from "@/components/meal-planning/mark-cooked-dialog";
import type { WeekPicksPlanning } from "@/components/meal-planning/use-week-picks";
import {
  daySlots,
  TODAY_CARD_ID,
  type MealPlanningDict,
  type PlannerDay,
} from "@/components/meal-planning/week-planner-helpers";
import type { RecipeTag } from "@/lib/recipe-tags";
import { format } from "@/lib/i18n/format";
import type { MealPlanEntryData, PreparedBatchData, RecipeData } from "@/components/meal-planning/types";
import type { Locale } from "@/lib/i18n/locales";

// One day of the week planner: its planned meals, a "Place here" target
// while a pick is lifted, and the day's "+ Add meal". It is also a drop
// target for a dragged pick or planned meal.
export function WeekDayCard({
  dict,
  locale,
  day,
  entries,
  recipes,
  recipeCooked,
  batches,
  requiredTags,
  weekStartKey,
  isPastWeek,
  selectMode,
  selectedIds,
  onToggleSelected,
  onPlanLeftovers,
  planning,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  day: PlannerDay;
  entries: MealPlanEntryData[];
  recipes: RecipeData[];
  recipeCooked: Record<string, RecipeCookedStats>;
  batches: PreparedBatchData[];
  requiredTags: RecipeTag[];
  weekStartKey: string;
  isPastWeek: boolean;
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelected: (id: string) => void;
  onPlanLeftovers: (request: PlanLeftoversRequest) => void;
  planning: WeekPicksPlanning;
}) {
  const wp = dict.weekPicks;
  const { drag, dropTarget, lifted, pointer, picks } = planning;
  // A day lists only what's planned, slot by slot, then one
  // "+ Add meal" that asks for the slot (UX-21's empty-day row, now
  // on every day). Four slot headers per day, three of them "Add
  // meal", made a phone week four screens long (DESIGN.md M6).
  const { sorted: dayEntries, openSlot } = daySlots(entries);
  const dayLabel = day.label;
  return (
    <Card
      id={day.isToday ? TODAY_CARD_ID : undefined}
      aria-current={day.isToday ? "date" : undefined}
      className={cn(
        "transition-shadow",
        day.isToday && "scroll-mt-2 ring-2 ring-primary/50 max-sm:scroll-mt-18",
        dropTarget === day.dateKey && "ring-2 ring-primary",
      )}
      {...planning.dropZone(day.dateKey, drag?.kind === "pick" || (drag?.kind === "entry" && drag.entry.date !== day.dateKey), () => {
        if (drag?.kind === "pick") planning.placePick(drag.pick, day.dateKey, openSlot, dayLabel);
        else if (drag?.kind === "entry") planning.moveEntry(drag.entry, day.dateKey, dayLabel);
      })}
    >
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between">
          <span>{day.weekdayLabel}</span>
          <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            {/* UX-99: today is said in words, not only by the ring
                (DESIGN.md Accessibility: never colour alone). */}
            {day.isToday && <Badge>{dict.todayBadge}</Badge>}
            {day.dayOfMonth}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {dayEntries.map((entry) => (
          <MealEntryRow
            key={entry.id}
            dict={dict}
            locale={locale}
            entry={entry}
            dayLabel={dayLabel}
            recipes={recipes}
            requiredTags={requiredTags}
            weekStartKey={weekStartKey}
            onPlanLeftovers={onPlanLeftovers}
            selectMode={selectMode}
            selected={selectedIds.has(entry.id)}
            onToggleSelected={onToggleSelected}
            onBackToPicks={isPastWeek ? undefined : planning.backToPicks}
            draggable={pointer}
            onDragStart={(event) =>
              planning.startDrag(event, { kind: "entry", entry }, entry.recipeName ?? entry.freeformName ?? "")
            }
            onDragEnd={planning.endDrag}
          />
        ))}
        {lifted && !selectMode && (
          <button
            type="button"
            aria-label={format(wp.placeHereLabel, { name: lifted.name, day: dayLabel })}
            onClick={() => planning.placePick(lifted, day.dateKey, openSlot, dayLabel)}
            className="min-h-11 rounded-lg border-[1.5px] border-dashed border-primary/55 bg-primary/5 text-sm font-semibold text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {wp.placeHere}
          </button>
        )}
        {!selectMode && (
          <AddMealSlot
            key={openSlot}
            dict={dict}
            weekStartKey={weekStartKey}
            dateKey={day.dateKey}
            dayLabel={dayLabel}
            mealType={openSlot}
            recipes={recipes}
            recipeCooked={recipeCooked}
            batches={batches}
            picks={picks}
            onPlacePick={(pick, mealType) => planning.placePick(pick, day.dateKey, mealType, dayLabel)}
          />
        )}
      </CardContent>
    </Card>
  );
}
