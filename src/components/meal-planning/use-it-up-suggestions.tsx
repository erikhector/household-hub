"use client";

// "Use it up" suggestion chips (BACKLOG GAP-1) — a read-only nudge on the
// Recipes tab ranking recipes by overlap with what's expiring soon or
// running low (src/lib/inventory/use-it-up-calc.ts), distinct from
// CookNowList's "almost everything on hand" full-match tab. This never
// creates a meal-plan entry or touches inventory — dismissing a chip only
// ever hides it on this device, same as MealVarietyRecap.
//
// Placed on the Recipes tab rather than the Planner: the suggestion is about
// *which recipe to reach for*, which is what that tab already lists, while
// the Planner is about *which day/slot* — a decision this feature doesn't
// help with. It reuses RecipeManager's existing recipe list underneath it,
// same as CookNowList reuses `recipes` for its "add to plan" dialog.
//
// Dismissal persists via localStorage keyed by recipe id -> a "signature" of
// which ingredients triggered the suggestion (its matched names, sorted),
// the same reappear-on-change trick MealVarietyRecap uses for its count: a
// dismissed "uses milk, eggs" nudge stays hidden, but a genuinely different
// "uses flour, sugar" nudge for the same recipe next week isn't suppressed
// by yesterday's dismissal.

import { useState, useSyncExternalStore } from "react";
import { Recycle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, plural } from "@/lib/i18n/format";
import type { UseItUpSuggestionData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

const DISMISSED_STORAGE_KEY = "mealPlanning.useItUpDismissed";

function signatureFor(suggestion: UseItUpSuggestionData): string {
  return suggestion.matches
    .map((match) => match.name)
    .sort()
    .join("|");
}

// No-op subscribe: nothing external notifies this of changes — a dismissal
// made in this tab flows through the `justDismissed` state below instead,
// same reasoning as MealVarietyRecap's identical no-op subscribe.
function subscribe() {
  return () => {};
}

function getSnapshot(): string | null {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

function parseDismissed(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// Picks the chip's wording: reason-specific when every match agrees (the
// common case, and the one the "uses 2 things expiring soon" pitch is
// written for), a neutral "expiring or running low" phrasing when a
// suggestion mixes both (an item can be both, see reasonFor in
// use-it-up-calc.ts, and a recipe can combine two such items).
function chipTemplate(dict: MealPlanningDict, suggestion: UseItUpSuggestionData) {
  const reasons = new Set(suggestion.matches.map((match) => match.reason));
  if (reasons.size > 1) return dict.useItUpChipMixed;
  return reasons.has("expiring") ? dict.useItUpChipExpiring : dict.useItUpChipLowStock;
}

export function UseItUpSuggestions({
  suggestions,
  dict,
}: {
  suggestions: UseItUpSuggestionData[];
  dict: MealPlanningDict;
}) {
  // useSyncExternalStore (not useState+useEffect) is the React-recommended
  // way to read an external, client-only value like localStorage during
  // render — mirrors MealVarietyRecap's identical pattern. getServerSnapshot
  // always returns null so SSR and the first client render agree.
  const dismissedRaw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [justDismissed, setJustDismissed] = useState<ReadonlySet<string>>(new Set());

  const dismissed = parseDismissed(dismissedRaw);
  const visible = suggestions.filter(
    (suggestion) =>
      !justDismissed.has(suggestion.recipeId) && dismissed[suggestion.recipeId] !== signatureFor(suggestion),
  );

  if (visible.length === 0) return null;

  function handleDismiss(suggestion: UseItUpSuggestionData) {
    setJustDismissed((prev) => new Set(prev).add(suggestion.recipeId));
    try {
      const next = { ...parseDismissed(getSnapshot()), [suggestion.recipeId]: signatureFor(suggestion) };
      localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (private browsing, blocked site data) —
      // dismiss still works for this render via justDismissed, just won't
      // persist across navigation.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{dict.useItUpLabel}</p>
      <div className="flex flex-wrap gap-2">
        {visible.map((suggestion) => (
          <div
            key={suggestion.recipeId}
            className="flex items-center gap-1.5 rounded-full border border-dashed py-1 pl-3 pr-1 text-sm"
          >
            <Recycle className="size-3.5 shrink-0 text-primary" />
            <span>
              {format(plural(suggestion.matches.length, chipTemplate(dict, suggestion)), {
                recipe: suggestion.recipeName,
                count: suggestion.matches.length,
              })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 text-muted-foreground"
              aria-label={dict.useItUpDismissAriaLabel}
              onClick={() => handleDismiss(suggestion)}
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
