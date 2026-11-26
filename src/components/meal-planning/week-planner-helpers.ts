import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { copyWeekAction, undoCopyWeekAction } from "@/app/dashboard/meal-planning/planner-actions";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { addDays, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import type { Weekday } from "@/lib/week-picks-spread";
import { format, plural } from "@/lib/i18n/format";
import type { MealPlanEntryData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";

// The week planner's pure pieces (MAINT-109): what the week's days are,
// what's planned on them and where a new meal or pick may go. Kept out of
// week-planner.tsx so they can be unit tested without rendering it.

export type MealPlanningDict = Dictionary["mealPlanning"];

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

export const mealTypeDictKey: Record<MealType, MealTypeLabelKey> = {
  BREAKFAST: "mealTypeBreakfast",
  LUNCH: "mealTypeLunch",
  DINNER: "mealTypeDinner",
  SNACK: "mealTypeSnack",
};

// The desktop grid (`auto-fit,minmax(16rem,1fr)`) shows every day side by
// side, but on a phone-width viewport the same grid stacks into one column,
// so today's card used to be several screens below the fold (D8 in
// docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md). UX-21 replaced the "Jump to
// today" button with scrolling there on load.
export const TODAY_CARD_ID = "meal-planner-today-card";

// GAP-23: only offered on an empty week, which is exactly when a household
// sitting down to plan would reach for it. On a partly filled week the
// action would still work (it skips filled slots), but a menu item that
// silently copies "around" existing meals is harder to predict. The Undo
// takes back exactly the entries this copy wrote, by id. The menu item
// closes on tap, so the planner shows the pending state on the ⋯ trigger
// instead (UX-213). A dropped connection rejects the call, and that is a
// toast saying so, not the error boundary (M8).
export function copyLastWeek(
  dict: MealPlanningDict,
  weekStartKey: string,
  prevWeekKey: string,
  startTransition: (callback: () => Promise<void>) => void,
) {
  startTransition(async () => {
    let result;
    try {
      result = await copyWeekAction(prevWeekKey, weekStartKey);
    } catch (error) {
      unstable_rethrow(error);
      toast.error(dict.prepConnectionError);
      return;
    }
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

// UX-15: "28 sep.–4 okt. 2026" in sv, "Sep 28 – Oct 4, 2026" in en —
// formatRange drops the repeated month/year itself. parseDateKey gives UTC
// midnight, so formatting in UTC names the same days on the server and in
// every browser (no hydration mismatch, no off-by-one west of Greenwich).
// The spacing around the dash is engine-specific: Node's ICU writes thin
// spaces ("Oct 12\u2009–\u200918") where Safari writes plain ones, which
// made every English planner load a hydration mismatch on iPhones (caught
// by the WebKit `iphone` e2e project, UX-32). Plain spaces on both sides.
export function formatWeekRange(locale: Locale, weekStart: Date): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
    .formatRange(weekStart, addDays(weekStart, 6))
    .replace(/[\u2009\u202f]/g, " ");
}

export type PlannerDay = {
  dateKey: string;
  dayOfMonth: number;
  weekdayLabel: string;
  isToday: boolean;
  // "Mon 28", how a dialog or toast names the day.
  label: string;
};

export function buildWeek(
  dict: Pick<MealPlanningDict, (typeof weekdayKeys)[number]>,
  weekStart: Date,
  todayKey: string,
  entries: MealPlanEntryData[],
) {
  const days: PlannerDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dateKey = toDateKey(date);
    const weekdayLabel = dict[weekdayKeys[i]];
    return {
      dateKey,
      dayOfMonth: date.getUTCDate(),
      weekdayLabel,
      isToday: dateKey === todayKey,
      label: `${weekdayLabel} ${date.getUTCDate()}`,
    };
  });

  const entriesByDay = new Map<string, MealPlanEntryData[]>();
  for (const entry of entries) {
    const list = entriesByDay.get(entry.date) ?? [];
    list.push(entry);
    entriesByDay.set(entry.date, list);
  }

  // GAP-45: days with nothing planned that haven't passed yet (filling
  // Monday on a Thursday would plan a dinner nobody can cook), and the
  // recipes already on the plan so a proposal never repeats one.
  const emptyDays = days
    .filter((day) => !entriesByDay.has(day.dateKey) && day.dateKey >= todayKey)
    .map((day) => ({ dateKey: day.dateKey, label: day.label }));
  // UX-50: where an empty week's "Add first dinner" lands: today, or
  // the next day this week, or Monday of a week already over.
  const firstOpenDay = days.find((day) => day.dateKey >= todayKey) ?? days[0];
  const plannedRecipeIds = [...new Set(entries.flatMap((e) => (e.recipeId ? [e.recipeId] : [])))];

  // Week picks: where Spread may put a pick (free dinners from today on, like
  // Fill empty days), and what a pick's place sheet lists per day.
  const freeDinners = days.flatMap((day, i) =>
    day.dateKey >= todayKey && !(entriesByDay.get(day.dateKey) ?? []).some((e) => e.mealType === "DINNER")
      ? [{ weekday: i as Weekday, dateKey: day.dateKey, label: day.label }]
      : [],
  );
  const placeDays = days.map((day) => ({
    dateKey: day.dateKey,
    label: day.label,
    entries: entriesByDay.get(day.dateKey) ?? [],
  }));

  return { days, entriesByDay, emptyDays, firstOpenDay, plannedRecipeIds, freeDinners, placeDays };
}

// A day lists only what's planned, slot by slot, then one "+ Add meal" that
// asks for the slot. The add dialog preselects dinner, or the first slot
// still empty once dinner is planned.
export function daySlots(entries: readonly MealPlanEntryData[]): { sorted: MealPlanEntryData[]; openSlot: MealType } {
  const sorted = [...entries].sort((a, b) => MEAL_TYPES.indexOf(a.mealType) - MEAL_TYPES.indexOf(b.mealType));
  const openSlot = sorted.some((e) => e.mealType === "DINNER")
    ? (MEAL_TYPES.find((type) => !sorted.some((e) => e.mealType === type)) ?? "DINNER")
    : "DINNER";
  return { sorted, openSlot };
}
