"use client";

// Small, dismissible recap (see JOY_GAP_BACKLOG.md item 6c) — mirrors
// MealVarietyRecap's shape exactly. Framed as coverage, crediting each
// completer by name against what they did; never a count or a per-person
// ranking (see item 6's Guardrails scope note) — the caller only renders
// this when `groups` is non-empty, so a quiet week shows nothing.

import { useState } from "react";
import { ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type WeeklyRecapGroupView = { memberName: string | null; titles: string[] };

export function TasksWeeklyRecap({
  groups,
  dict,
}: {
  groups: WeeklyRecapGroupView[];
  dict: Dictionary["tasks"];
}) {
  const [dismissed, setDismissed] = useState(false);
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
        onClick={() => setDismissed(true)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
