"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddMealDialog } from "@/components/meal-planning/add-meal-dialog";
import { MissingIngredientsDialog } from "@/components/meal-planning/missing-ingredients-dialog";
import { deleteMealEntryAction } from "@/app/dashboard/meal-planning/actions";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { addDays, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { format, plural } from "@/lib/i18n/format";
import type { ActiveShoppingListOption, MealPlanEntryData, RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

const weekdayKeys = [
  "weekdayMon",
  "weekdayTue",
  "weekdayWed",
  "weekdayThu",
  "weekdayFri",
  "weekdaySat",
  "weekdaySun",
] as const satisfies readonly (keyof MealPlanningDict)[];

type MealTypeLabelKey = "mealTypeBreakfast" | "mealTypeLunch" | "mealTypeDinner" | "mealTypeSnack";

const mealTypeDictKey: Record<MealType, MealTypeLabelKey> = {
  BREAKFAST: "mealTypeBreakfast",
  LUNCH: "mealTypeLunch",
  DINNER: "mealTypeDinner",
  SNACK: "mealTypeSnack",
};

export function WeekPlanner({
  dict,
  weekStartKey,
  recipes,
  entries,
  activeShoppingLists,
}: {
  dict: MealPlanningDict;
  weekStartKey: string;
  recipes: RecipeData[];
  entries: MealPlanEntryData[];
  activeShoppingLists: ActiveShoppingListOption[];
}) {
  const weekStart = parseDateKey(weekStartKey);
  const weekEnd = addDays(weekStart, 6);
  const todayKey = toDateKey(new Date());

  const prevWeekKey = toDateKey(addDays(weekStart, -7));
  const nextWeekKey = toDateKey(addDays(weekStart, 7));

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dateKey = toDateKey(date);
    return {
      dateKey,
      dayOfMonth: date.getUTCDate(),
      weekdayLabel: dict[weekdayKeys[i]],
      isToday: dateKey === todayKey,
    };
  });

  const entriesByDay = new Map<string, MealPlanEntryData[]>();
  for (const entry of entries) {
    const list = entriesByDay.get(entry.date) ?? [];
    list.push(entry);
    entriesByDay.set(entry.date, list);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label={dict.previousWeek} render={
            <Link href={`/dashboard/meal-planning?week=${prevWeekKey}`} />
          }>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label={dict.nextWeek} render={
            <Link href={`/dashboard/meal-planning?week=${nextWeekKey}`} />
          }>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <p className="text-sm font-medium">
          {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {" – "}
          {weekEnd.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" render={<Link href="/dashboard/meal-planning" />}>
            {dict.thisWeek}
          </Button>
          <MissingIngredientsDialog
            dict={dict}
            weekStartKey={weekStartKey}
            activeShoppingLists={activeShoppingLists}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((day) => (
          <Card key={day.dateKey} className={day.isToday ? "ring-2 ring-primary/50" : undefined}>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between">
                <span>{day.weekdayLabel}</span>
                <span className="text-sm font-normal text-muted-foreground">{day.dayOfMonth}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {MEAL_TYPES.map((mealType) => (
                <MealTypeSlot
                  key={mealType}
                  dict={dict}
                  mealType={mealType}
                  dateKey={day.dateKey}
                  weekStartKey={weekStartKey}
                  recipes={recipes}
                  entries={(entriesByDay.get(day.dateKey) ?? []).filter((e) => e.mealType === mealType)}
                />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function MealTypeSlot({
  dict,
  mealType,
  dateKey,
  weekStartKey,
  recipes,
  entries,
}: {
  dict: MealPlanningDict;
  mealType: MealType;
  dateKey: string;
  weekStartKey: string;
  recipes: RecipeData[];
  entries: MealPlanEntryData[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          {dict[mealTypeDictKey[mealType]]}
        </p>
        <AddMealDialog
          dict={dict}
          weekStartKey={weekStartKey}
          dateKey={dateKey}
          mealType={mealType}
          recipes={recipes}
        />
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">{dict.emptyDay}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <MealEntryRow key={entry.id} dict={dict} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function MealEntryRow({ dict, entry }: { dict: MealPlanningDict; entry: MealPlanEntryData }) {
  const [isPending, startTransition] = useTransition();
  const label = entry.recipeName ?? entry.freeformName ?? "";
  // Portions only mean something next to a linked recipe — a freeform entry
  // has nothing to scale (see MealPlanEntryData.portions' doc comment).
  const portionsLabel = entry.recipeId
    ? format(plural(entry.portions, dict.entryPortionsCount), { count: entry.portions })
    : null;

  return (
    <div className="flex items-center justify-between gap-1 rounded-md bg-muted px-2 py-1 text-sm">
      <span className="min-w-0 truncate" title={portionsLabel ? `${label} · ${portionsLabel}` : label}>
        {label}
        {portionsLabel && <span className="text-muted-foreground"> · {portionsLabel}</span>}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        disabled={isPending}
        aria-label={dict.removeMealAriaLabel}
        onClick={() => startTransition(() => deleteMealEntryAction(entry.id))}
      >
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
}
