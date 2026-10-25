"use client";

import { useOptimistic, useTransition } from "react";
import { CalendarRange } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_BUDGET_MONTH_START_DAY, MIN_BUDGET_MONTH_START_DAY } from "@/lib/budget-date-utils";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const DAYS = Array.from(
  { length: MAX_BUDGET_MONTH_START_DAY - MIN_BUDGET_MONTH_START_DAY + 1 },
  (_, i) => MIN_BUDGET_MONTH_START_DAY + i,
);

// UX-134's card: which day a budget's month starts on. Saves on change like
// CurrencySetting (a click action, shown straight away via useOptimistic,
// which snaps back if the save fails). Shared by the Household page (the
// household budget's day: everyone sees it, only the owner can change it,
// which setBudgetMonthStartDayAction enforces server-side too) and the
// Personal Budget's Manage tab (the user's own day, always editable).
export function BudgetMonthSetting({
  id,
  startDay,
  canEdit,
  action,
  dict,
}: {
  /** The select's id, unique per page. */
  id: string;
  startDay: number;
  canEdit: boolean;
  action: (day: number) => Promise<ActionState>;
  /** `ownerOnlyHint` shows under a disabled select; only the household's
   * card has one. */
  dict: Omit<Dictionary["household"]["budgetMonth"], "ownerOnlyHint"> & { ownerOnlyHint?: string };
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticDay, setOptimisticDay] = useOptimistic(startDay);

  // Base UI's SelectValue shows the raw value, so each day maps to its label.
  const label = (day: number) => format(day === 1 ? dict.calendarOption : dict.dayOption, { day });

  function handleChange(next: number) {
    if (next === optimisticDay) return;
    startTransition(async () => {
      setOptimisticDay(next);
      const result = await action(next);
      if (result.error) toast.error(result.error);
      else toast.success(dict.savedToast);
    });
  }

  return (
    <div className="list-bleed flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
          <CalendarRange className="size-4 shrink-0" />
          {dict.title}
        </h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{dict.label}</Label>
        <Select
          value={optimisticDay}
          onValueChange={(v) => v != null && handleChange(Number(v))}
          disabled={!canEdit || isPending}
        >
          <SelectTrigger id={id} className="w-full sm:w-72">
            <SelectValue>{(v: number) => label(v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DAYS.map((day) => (
              <SelectItem key={day} value={day}>
                {label(day)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!canEdit && dict.ownerOnlyHint && <p className="text-sm text-muted-foreground">{dict.ownerOnlyHint}</p>}
      </div>
      <p className="text-sm text-muted-foreground">{dict.hint}</p>
    </div>
  );
}
