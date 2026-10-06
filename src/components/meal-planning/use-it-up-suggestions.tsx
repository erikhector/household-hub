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

import { Recycle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDismissedLocalStorage } from "@/components/shared/use-dismissed-local-storage";
import { USE_IT_UP_DISMISSED_STORAGE_KEY } from "@/lib/cookie-inventory";
import { format, plural } from "@/lib/i18n/format";
import type { UseItUpSuggestionData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

function signatureFor(suggestion: UseItUpSuggestionData): string {
  return suggestion.matches
    .map((match) => match.name)
    .sort()
    .join("|");
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
  const [dismissedRaw, setDismissedRaw] = useDismissedLocalStorage(USE_IT_UP_DISMISSED_STORAGE_KEY);

  const dismissed = parseDismissed(dismissedRaw);
  const visible = suggestions.filter((suggestion) => dismissed[suggestion.recipeId] !== signatureFor(suggestion));

  if (visible.length === 0) return null;

  function handleDismiss(suggestion: UseItUpSuggestionData) {
    setDismissedRaw(JSON.stringify({ ...dismissed, [suggestion.recipeId]: signatureFor(suggestion) }));
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
              className="size-5 shrink-0 text-muted-foreground max-sm:size-11 pointer-coarse:size-11"
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
