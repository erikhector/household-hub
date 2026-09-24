"use client";

// Shown above BudgetTabs when /dashboard/budget is displaying a household
// other than the active one (a "View in {household} Budget" link from
// Personal Budget, see src/lib/budget-household-view.ts). Explains why the
// write controls below are disabled and offers the one-click fix: switch the
// active household to the one on screen, then land back on the same month,
// now writable. switchHouseholdAction re-checks membership server-side, so
// the id passed here is never trusted on its own.

import { useTransition } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { switchHouseholdAction } from "@/lib/actions/household";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function ReadOnlyHouseholdBanner({
  householdId,
  householdName,
  activeHouseholdName,
  returnTo,
  dict,
}: {
  householdId: string;
  householdName: string;
  activeHouseholdName: string;
  /** Where to land after switching, e.g. `/dashboard/budget?month=2026-09`. */
  returnTo: string;
  dict: Dictionary["budget"]["readOnlyHousehold"];
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/50 px-4 py-3"
    >
      <div className="flex items-start gap-2 text-sm">
        <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p>
          {format(dict.message, { household: householdName, active: activeHouseholdName })}
        </p>
      </div>
      <Button
        size="sm"
        disabled={isPending}
        onClick={() => startTransition(() => switchHouseholdAction(householdId, returnTo))}
      >
        {format(dict.switchButton, { household: householdName })}
      </Button>
    </div>
  );
}
