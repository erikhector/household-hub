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
// docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md, and TasksWeeklyRecap (Scope E, finding
// E2) for the identical gap in Tasks — no shared dismiss-persistence helper
// exists yet, so this is a self-contained implementation, not (yet) a
// reusable one.

import { useState, useSyncExternalStore } from "react";
import { Salad, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const DISMISSED_COUNT_STORAGE_KEY = "mealPlanning.varietyRecapDismissedCount";

// No-op subscribe: nothing external notifies this of changes — a dismissal
// made in this tab flows through the `justDismissed` state below instead,
// same stable-reference reasoning as useThemeCycle's own no-op subscribe.
function subscribe() {
  return () => {};
}

function getSnapshot(): string | null {
  try {
    return localStorage.getItem(DISMISSED_COUNT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

export function MealVarietyRecap({ count, dict }: { count: number; dict: Dictionary["mealPlanning"] }) {
  // useSyncExternalStore (not useState+useEffect, which would mean calling
  // setState synchronously inside an effect) is the React-recommended way to
  // read an external, client-only value like localStorage during render —
  // mirrors useThemeCycle's identical "mounted" pattern elsewhere in this
  // app. getServerSnapshot always returns null so SSR and the first client
  // render agree (no hydration mismatch); React reconciles the real,
  // possibly-dismissed value right after hydration.
  const dismissedCount = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [justDismissed, setJustDismissed] = useState(false);

  if (justDismissed || dismissedCount === String(count)) return null;

  function handleDismiss() {
    setJustDismissed(true);
    try {
      localStorage.setItem(DISMISSED_COUNT_STORAGE_KEY, String(count));
    } catch {
      // localStorage unavailable (private browsing, blocked site data) —
      // dismiss still works for this render via justDismissed, just won't
      // persist across navigation.
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <Salad className="size-4 shrink-0" />
      <p className="flex-1">{format(plural(count, dict.varietyRecap), { count })}</p>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground"
        aria-label={dict.varietyRecapDismissAriaLabel}
        onClick={handleDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
