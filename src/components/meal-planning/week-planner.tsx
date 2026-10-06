"use client";

import { type ReactNode, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarClock, ChefHat, CheckCircle2, ChevronLeft, ChevronRight, Copy, CookingPot, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CookModeDialog } from "@/components/meal-planning/cook-mode-dialog";
import { MealEntryDialog } from "@/components/meal-planning/meal-entry-dialog";
import { MissingIngredientsDialog } from "@/components/meal-planning/missing-ingredients-dialog";
import { MarkCookedDialog } from "@/components/meal-planning/mark-cooked-dialog";
import { MoveMealDialog } from "@/components/meal-planning/move-meal-dialog";
import {
  copyWeekAction,
  deleteMealEntryAction,
  undoCopyWeekAction,
} from "@/app/dashboard/meal-planning/planner-actions";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { addDays, getWeekStart, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { format, plural } from "@/lib/i18n/format";
import type { ActiveShoppingListOption, MealPlanEntryData, RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";

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

// The desktop grid (`auto-fit,minmax(16rem,1fr)`) shows every day side by
// side, but on a phone-width viewport the same grid stacks into one column,
// so today's card can be several screens below the fold with nothing on
// screen naming it as "today" — see D8 in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md.
const TODAY_CARD_ID = "meal-planner-today-card";

// Two different jobs depending on whether the currently *displayed* week is
// the real current week: if it isn't, this is really "go to this week" (same
// destination as the "This week" button next to it); if it is, the week is
// already right there in the DOM and this just scrolls the page down to it.
// Kept mobile-only (`sm:hidden`) since the desktop grid never needs it.
function JumpToTodayButton({ dict, weekStartKey }: { dict: MealPlanningDict; weekStartKey: string }) {
  const isCurrentWeek = weekStartKey === toDateKey(getWeekStart(new Date()));

  if (!isCurrentWeek) {
    return (
      <Button variant="outline" size="sm" className="sm:hidden" render={<Link href="/dashboard/meal-planning" />}>
        <CalendarClock className="size-4" />
        {dict.jumpToToday}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="sm:hidden"
      onClick={() =>
        document.getElementById(TODAY_CARD_ID)?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
    >
      <CalendarClock className="size-4" />
      {dict.jumpToToday}
    </Button>
  );
}

// GAP-23: only offered on an empty week, which is exactly when a household
// sitting down to plan would reach for it. On a partly filled week the
// action would still work (it skips filled slots), but a button that
// silently copies "around" existing meals is harder to predict. The Undo
// takes back exactly the entries this copy wrote, by id.
function CopyLastWeekButton({
  dict,
  weekStartKey,
  prevWeekKey,
}: {
  dict: MealPlanningDict;
  weekStartKey: string;
  prevWeekKey: string;
}) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await copyWeekAction(prevWeekKey, weekStartKey);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const entryIds = result.entryIds ?? [];
      if (entryIds.length === 0) {
        toast(dict.copyLastWeekNothingToast);
        return;
      }
      toast.success(format(plural(entryIds.length, dict.copyLastWeekToast), { count: entryIds.length }), {
        duration: 8000,
        action: {
          label: dict.copyLastWeekUndo,
          onClick: () => {
            void undoCopyWeekAction(entryIds).then((undoResult) => {
              if (undoResult.error) toast.error(undoResult.error);
              else toast.success(dict.copyLastWeekUndoneToast);
            });
          },
        },
      });
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={handleClick}>
      <Copy className="size-4" />
      {dict.copyLastWeek}
    </Button>
  );
}

export function WeekPlanner({
  dict,
  locale,
  weekStartKey,
  recipes,
  entries,
  activeShoppingLists,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  weekStartKey: string;
  recipes: RecipeData[];
  entries: MealPlanEntryData[];
  activeShoppingLists: ActiveShoppingListOption[];
}) {
  const weekStart = parseDateKey(weekStartKey);
  const weekEnd = addDays(weekStart, 6);
  // UX-15: "28 sep.–4 okt. 2026" in sv, "Sep 28 – Oct 4, 2026" in en —
  // formatRange drops the repeated month/year itself. parseDateKey gives UTC
  // midnight, so formatting in UTC names the same days on the server and in
  // every browser (no hydration mismatch, no off-by-one west of Greenwich).
  const weekRange = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(weekStart, weekEnd);
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
        <p className="text-sm font-medium">{weekRange}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" render={<Link href="/dashboard/meal-planning" />}>
            {dict.thisWeek}
          </Button>
          <JumpToTodayButton dict={dict} weekStartKey={weekStartKey} />
          {entries.length === 0 && (
            <CopyLastWeekButton dict={dict} weekStartKey={weekStartKey} prevWeekKey={prevWeekKey} />
          )}
          <MissingIngredientsDialog
            dict={dict}
            weekStartKey={weekStartKey}
            activeShoppingLists={activeShoppingLists}
          />
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-3">
        {days.map((day) => (
          <Card
            key={day.dateKey}
            id={day.isToday ? TODAY_CARD_ID : undefined}
            className={day.isToday ? "ring-2 ring-primary/50" : undefined}
          >
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between">
                <span>{day.weekdayLabel}</span>
                <span className="text-sm font-normal text-muted-foreground">{day.dayOfMonth}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {MEAL_TYPES.map((mealType) => (
                <MealTypeSlot
                  key={mealType}
                  dict={dict}
                  locale={locale}
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
  locale,
  mealType,
  dateKey,
  weekStartKey,
  recipes,
  entries,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  mealType: MealType;
  dateKey: string;
  weekStartKey: string;
  recipes: RecipeData[];
  entries: MealPlanEntryData[];
}) {
  const label = dict[mealTypeDictKey[mealType]];

  // UX-5: an empty slot is a single tappable "<slot> + Add meal" row, so an
  // empty week isn't 28 repeated "Nothing planned" lines with tiny "+" buttons.
  if (entries.length === 0) {
    return (
      <MealEntryDialog
        dict={dict}
        weekStartKey={weekStartKey}
        dateKey={dateKey}
        mealType={mealType}
        recipes={recipes}
        slotLabel={label}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
        <MealEntryDialog
          dict={dict}
          weekStartKey={weekStartKey}
          dateKey={dateKey}
          mealType={mealType}
          recipes={recipes}
        />
      </div>
      <div className="flex flex-col gap-1">
        {entries.map((entry) => (
          <MealEntryRow
            key={entry.id}
            dict={dict}
            locale={locale}
            entry={entry}
            recipes={recipes}
            weekStartKey={weekStartKey}
          />
        ))}
      </div>
    </div>
  );
}

// Every row reserves the same five fixed-width slots after the label (cook,
// edit, move, cooked-status, delete) — even when a slot has nothing to show —
// so the icon column lines up across rows instead of shifting with each
// entry's state (freeform vs. recipe-linked, cooked vs. not). On phones the
// icon buttons are 44px (DESIGN.md M3), so the slot grows with them instead of
// letting neighbours overlap.
function IconSlot({ children }: { children?: ReactNode }) {
  return <span className="flex size-6 shrink-0 items-center justify-center max-sm:size-11">{children}</span>;
}

function MealEntryRow({
  dict,
  locale,
  entry,
  recipes,
  weekStartKey,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  entry: MealPlanEntryData;
  recipes: RecipeData[];
  weekStartKey: string;
}) {
  const label = entry.recipeName ?? entry.freeformName ?? "";
  const linkedRecipe = entry.recipeId ? recipes.find((recipe) => recipe.id === entry.recipeId) : undefined;
  const cookRecipe = linkedRecipe?.instructions?.trim() ? linkedRecipe : null;
  // Portions only mean something next to a linked recipe — a freeform entry
  // has nothing to scale (see MealPlanEntryData.portions' doc comment).
  const portionsLabel = entry.recipeId
    ? format(plural(entry.portions, dict.entryPortionsCount), { count: entry.portions })
    : null;

  return (
    <div className="flex items-center justify-between gap-1 rounded-md bg-muted px-2 py-1 text-sm max-sm:flex-wrap max-sm:justify-end">
      <span className="min-w-0 flex-1 truncate max-sm:basis-full max-sm:break-words max-sm:whitespace-normal" title={portionsLabel ? `${label} · ${portionsLabel}` : label}>
        {label}
        {portionsLabel && <span className="text-muted-foreground"> · {portionsLabel}</span>}
      </span>

      {/* GAP-42: opens the cook view scaled to this entry's portions. Not
          gated on consumedAt: reading a recipe again is harmless. */}
      <IconSlot>
        {cookRecipe && (
          <CookModeDialog
            dict={dict}
            locale={locale}
            recipe={cookRecipe}
            portions={entry.portions}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                aria-label={format(dict.cookModeFromPlanAriaLabel, { meal: label })}
              >
                <CookingPot className="size-3" />
              </Button>
            }
          />
        )}
      </IconSlot>

      <IconSlot>
        {!entry.consumedAt && (
          <MealEntryDialog
            dict={dict}
            recipes={recipes}
            mode="edit"
            entry={entry}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                aria-label={dict.editMealAriaLabel}
              >
                <Pencil className="size-3" />
              </Button>
            }
          />
        )}
      </IconSlot>

      {/* GAP-30: hidden once cooked, same as the pencil. A cooked entry's
          day and slot record when it was actually eaten, so
          moveMealEntryAction refuses to move it (see its doc comment). */}
      <IconSlot>
        {!entry.consumedAt && (
          <MoveMealDialog dict={dict} entry={entry} label={label} plannerWeekStartKey={weekStartKey} />
        )}
      </IconSlot>

      <IconSlot>
        {entry.consumedAt ? (
          <span className="text-muted-foreground" title={dict.mealCookedBadgeLabel}>
            <CheckCircle2 className="size-3" aria-label={dict.mealCookedBadgeLabel} />
          </span>
        ) : entry.recipeId ? (
          <MarkCookedDialog dict={dict} entry={entry} />
        ) : (
          // Custom (non-recipe) entries have no ingredients to check inventory
          // against, so "mark cooked" is never available for them — surfaced
          // as a disabled, explained affordance instead of just omitting the
          // control, so it doesn't read as a bug. See D4 in
          // docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md.
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground/50"
            disabled
            aria-label={dict.markCookedUnavailableForCustomMeal}
            title={dict.markCookedUnavailableForCustomMeal}
          >
            <ChefHat className="size-3" />
          </Button>
        )}
      </IconSlot>

      <ConfirmDialog
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={dict.removeMealAriaLabel}
          >
            <Trash2 className="size-3" />
          </Button>
        }
        title={format(dict.confirmDeleteMeal.title, { meal: label })}
        description={entry.consumedAt ? dict.confirmDeleteMeal.descriptionCooked : dict.confirmDeleteMeal.description}
        cancelLabel={dict.confirmDeleteMeal.cancel}
        confirmLabel={dict.confirmDeleteMeal.confirm}
        pendingLabel={dict.confirmDeleteMeal.confirming}
        onConfirm={() => deleteMealEntryAction(entry.id)}
      />
    </div>
  );
}
