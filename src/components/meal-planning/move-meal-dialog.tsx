"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { moveMealEntryAction } from "@/app/dashboard/meal-planning/planner-actions";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { getWeekStart, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { format } from "@/lib/i18n/format";
import type { MealPlanEntryData } from "@/components/meal-planning/types";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

type MealPlanningDict = Dictionary["mealPlanning"];

const initialState: ActionState = {};

type MealTypeLabelKey = "mealTypeBreakfast" | "mealTypeLunch" | "mealTypeDinner" | "mealTypeSnack";

const mealTypeDictKey: Record<MealType, MealTypeLabelKey> = {
  BREAKFAST: "mealTypeBreakfast",
  LUNCH: "mealTypeLunch",
  DINNER: "mealTypeDinner",
  SNACK: "mealTypeSnack",
};

// GAP-30: moves an uncooked entry to another day and/or meal type, backed by
// moveMealEntryAction. The same date + meal-type picker AddToPlanDialog uses,
// rather than drag-and-drop: it works the same on a phone (where the planner
// stacks into one long column, see D8 in
// docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md) and can reach any week, not
// just the one on screen. Moving into another week makes the meal vanish
// from the current view, so the toast says so and offers a shortcut there,
// same as AddToPlanDialog's.
export function MoveMealDialog({
  dict,
  entry,
  label,
  plannerWeekStartKey,
}: {
  dict: MealPlanningDict;
  entry: MealPlanEntryData;
  label: string;
  plannerWeekStartKey: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(entry.date);
  const [mealType, setMealType] = useState<MealType>(entry.mealType);

  const weekStartKey = toDateKey(getWeekStart(parseDateKey(date)));

  // Re-seed from the entry every time the dialog opens, so a cancelled
  // half-edit doesn't linger as the "current" day the next time.
  function handleOpenChange(next: boolean) {
    if (next) {
      setDate(entry.date);
      setMealType(entry.mealType);
    }
    setOpen(next);
  }

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await moveMealEntryAction(prevState, formData);
    if (!result.error) {
      setOpen(false);
      if (weekStartKey === plannerWeekStartKey) {
        toast.success(format(dict.mealMovedToast, { meal: label }));
      } else {
        toast.success(format(dict.mealMovedDifferentWeekToast, { meal: label }), {
          action: {
            label: dict.viewThatWeek,
            onClick: () => router.push(`/dashboard/meal-planning?week=${weekStartKey}`),
          },
        });
      }
    }
    return result;
  }, initialState);

  const dateInputId = `move-meal-date-${entry.id}`;
  const mealTypeInputId = `move-meal-type-${entry.id}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label={dict.moveMealAriaLabel}
            title={dict.moveMealAriaLabel}
          >
            <ArrowRightLeft className="size-3" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(dict.moveMealDialogTitle, { meal: label })}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="entryId" value={entry.id} />
          <input type="hidden" name="mealType" value={mealType} />

          <div className="flex flex-col gap-2">
            <Label htmlFor={dateInputId}>{dict.dateLabel}</Label>
            <Input
              id={dateInputId}
              name="date"
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={mealTypeInputId}>{dict.mealTypeLabel}</Label>
            <Select value={mealType} onValueChange={(v) => setMealType((v as MealType) ?? entry.mealType)}>
              <SelectTrigger id={mealTypeInputId} className="w-full">
                <SelectValue>{dict[mealTypeDictKey[mealType]]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MEAL_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {dict[mealTypeDictKey[type]]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              <PendingLabel pending={pending} busy={dict.moving} idle={dict.moveMealSubmit} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
