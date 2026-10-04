"use client";

// Small, dismissible recap (see docs/archive/JOY_GAP_BACKLOG.md item 5) — framed as
// variety, not a score, so it never renders for a quiet month rather than
// showing a zero or shaming copy (the caller only renders this component
// when `count > 0`).
//
// Dismissal persists via localStorage, keyed by the recap's own count (the
// only thing identifying "this" recap — there's no separate id) — so
// navigating away and back (e.g. switching tabs and back to Planner, or a
// route change) doesn't bring it back, but a genuinely new count (the
// trailing-30-day distinct-recipe tally changed) does. See D7 in
// docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md. The persistence itself lives in
// useDismissedLocalStorage, shared with the other recaps.

import { Salad, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDismissedLocalStorage } from "@/components/shared/use-dismissed-local-storage";
import { VARIETY_RECAP_DISMISSED_STORAGE_KEY } from "@/lib/cookie-inventory";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function MealVarietyRecap({ count, dict }: { count: number; dict: Dictionary["mealPlanning"] }) {
  const [dismissedCount, setDismissedCount] = useDismissedLocalStorage(VARIETY_RECAP_DISMISSED_STORAGE_KEY);

  if (dismissedCount === String(count)) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <Salad className="size-4 shrink-0" />
      <p className="flex-1">{format(plural(count, dict.varietyRecap), { count })}</p>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground max-sm:size-11"
        aria-label={dict.varietyRecapDismissAriaLabel}
        onClick={() => setDismissedCount(String(count))}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
