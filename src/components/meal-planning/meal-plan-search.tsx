"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { SearchInput } from "@/components/ui/search-input";
import type { MealSearchResult } from "@/app/dashboard/meal-planning/meal-plan-search";
import { searchMealPlanAction } from "@/app/dashboard/meal-planning/search-actions";
import { parseDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { MEAL_SEARCH_MIN_CHARS, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";

type MealPlanningDict = Dictionary["mealPlanning"];

// Wait for a pause in typing, so "lasagna" is one query rather than seven.
const DEBOUNCE_MS = 250;

const mealTypeKeys: Record<MealType, "mealTypeBreakfast" | "mealTypeLunch" | "mealTypeDinner" | "mealTypeSnack"> = {
  BREAKFAST: "mealTypeBreakfast",
  LUNCH: "mealTypeLunch",
  DINNER: "mealTypeDinner",
  SNACK: "mealTypeSnack",
};

// GAP-59: "when did we last have lasagna?" Each hit is a link to the planner
// week it sits in (`?week=`), so a match is one tap from the day.
export function MealPlanSearch({ dict, locale }: { dict: MealPlanningDict; locale: Locale }) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  // The results carry the query they answer, so a slow reply for an older
  // query never shows under newer text, and "nothing found" is only said
  // once the current text has actually been searched.
  const [answer, setAnswer] = useState<{ query: string; results: MealSearchResult[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const term = query.trim();
  const active = term.length >= MEAL_SEARCH_MIN_CHARS;

  useEffect(() => {
    if (!active) return;
    let stale = false;
    const timer = setTimeout(() => {
      searchMealPlanAction(term).then(
        (results) => {
          if (stale) return;
          setFailed(false);
          setAnswer({ query: term, results });
        },
        () => {
          if (!stale) setFailed(true);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [active, term]);

  const dateFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const settled = active && answer?.query === term;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {dict.searchPlanLabel}
      </label>
      <SearchInput
        id={inputId}
        value={query}
        onValueChange={setQuery}
        placeholder={dict.searchPlanPlaceholder}
        clearLabel={dict.clearSearch}
        autoComplete="off"
        maxLength={100}
      />
      <div aria-live="polite">
        {active && failed && <p className="text-sm text-destructive">{dict.searchPlanError}</p>}
        {active && !failed && settled && answer.results.length === 0 && (
          <p className="text-sm text-muted-foreground">{dict.searchPlanNoResults}</p>
        )}
      </div>
      {active && !failed && settled && answer.results.length > 0 && (
        <ul aria-label={dict.searchPlanResults} className="flex flex-col rounded-lg border">
          {answer.results.map((result) => (
            <li key={result.id} className="border-b last:border-b-0">
              <Link
                href={`/dashboard/meal-planning?week=${result.weekStartKey}`}
                className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {dateFormat.format(parseDateKey(result.dateKey))} · {dict[mealTypeKeys[result.mealType]]} · {result.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
