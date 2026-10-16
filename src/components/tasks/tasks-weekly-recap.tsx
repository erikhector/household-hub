"use client";

// Small, dismissible recap (see docs/archive/JOY_GAP_BACKLOG.md item 6c) — mirrors
// MealVarietyRecap's shape exactly. Framed as coverage, crediting each
// completer by name against what they did; never a count or a per-person
// ranking (see item 6's Guardrails scope note) — the caller only renders
// this when `groups` is non-empty, so a quiet week shows nothing.
//
// Dismissal persists in localStorage, keyed to the current Monday-start
// week (UX audit finding E2) — so it survives navigating away and back
// (previously an in-memory useState, reset on every remount), but a new
// week's recap still shows even if last week's was dismissed.
//
// The stored value is read through useDismissedLocalStorage, whose server
// snapshot is "not dismissed", so SSR and the first client render agree (no
// hydration mismatch).
import { ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDismissedLocalStorage } from "@/components/shared/use-dismissed-local-storage";
import { TASKS_RECAP_DISMISSED_STORAGE_KEY } from "@/lib/cookie-inventory";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type WeeklyRecapGroupView = { memberName: string | null; titles: string[] };

function currentWeekKey(): string {
  const now = new Date();
  const daysSinceMonday = (now.getDay() + 6) % 7; // getDay(): 0 (Sun) .. 6 (Sat)
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function TasksWeeklyRecap({
  groups,
  dict,
}: {
  groups: WeeklyRecapGroupView[];
  dict: Dictionary["tasks"];
}) {
  const [dismissedWeek, setDismissedWeek] = useDismissedLocalStorage(TASKS_RECAP_DISMISSED_STORAGE_KEY);

  if (dismissedWeek === currentWeekKey()) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <ListChecks className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{dict.weeklyRecapTitle}</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {groups.map((group, index) => (
            <li key={index} className="line-clamp-2 break-words sm:line-clamp-1">
              {group.memberName ?? dict.unassignedBadge}: {group.titles.join(", ")}
            </li>
          ))}
        </ul>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground max-sm:size-11 pointer-coarse:size-11"
        aria-label={dict.weeklyRecapDismissAriaLabel}
        onClick={() => setDismissedWeek(currentWeekKey())}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
