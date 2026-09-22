"use client";

// Small, dismissible recap (see JOY_GAP_BACKLOG.md item 6c) — mirrors
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
// `mounted` follows the same useSyncExternalStore convention as
// useThemeCycle (see src/components/theme/use-theme-cycle.ts): the server
// (and the client's very first render, to match SSR markup and avoid a
// hydration mismatch) never has localStorage, so both report "not dismissed"
// until mounted flips true on the next client render — at which point the
// stored value is read directly, a plain synchronous read rather than a
// setState tucked inside an effect.
import { useState, useSyncExternalStore } from "react";
import { ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type WeeklyRecapGroupView = { memberName: string | null; titles: string[] };

const DISMISSED_STORAGE_KEY = "tasks.weeklyRecap.dismissedWeek";

function currentWeekKey(): string {
  const now = new Date();
  const daysSinceMonday = (now.getDay() + 6) % 7; // getDay(): 0 (Sun) .. 6 (Sat)
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function subscribe() {
  return () => {};
}

export function TasksWeeklyRecap({
  groups,
  dict,
}: {
  groups: WeeklyRecapGroupView[];
  dict: Dictionary["tasks"];
}) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  // Tracks only a dismissal made during this render (the click handler
  // below) — the persisted-from-a-previous-visit case is read straight from
  // localStorage each render once mounted, not mirrored into state.
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  let dismissed = dismissedThisSession;
  if (!dismissed && mounted) {
    try {
      dismissed = localStorage.getItem(DISMISSED_STORAGE_KEY) === currentWeekKey();
    } catch {
      // Private browsing / blocked storage: fall back to "not dismissed" —
      // dismissing still works for the rest of the session via the onClick
      // handler below, it just won't survive a reload.
    }
  }

  if (dismissed) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <ListChecks className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{dict.weeklyRecapTitle}</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {groups.map((group, index) => (
            <li key={index} className="truncate">
              {group.memberName ?? dict.unassignedBadge}: {group.titles.join(", ")}
            </li>
          ))}
        </ul>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground"
        aria-label={dict.weeklyRecapDismissAriaLabel}
        onClick={() => {
          try {
            localStorage.setItem(DISMISSED_STORAGE_KEY, currentWeekKey());
          } catch {
            // Storage unavailable — dismissal still applies for this render
            // via setDismissedThisSession below, just won't persist past a
            // reload.
          }
          setDismissedThisSession(true);
        }}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
