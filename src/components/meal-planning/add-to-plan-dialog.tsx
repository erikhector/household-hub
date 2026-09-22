"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
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
import { addMealEntryAction } from "@/app/dashboard/meal-planning/planner-actions";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { getWeekStart, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

const initialState: ActionState = {};

type MealTypeLabelKey = "mealTypeBreakfast" | "mealTypeLunch" | "mealTypeDinner" | "mealTypeSnack";

const mealTypeDictKey: Record<MealType, MealTypeLabelKey> = {
  BREAKFAST: "mealTypeBreakfast",
  LUNCH: "mealTypeLunch",
  DINNER: "mealTypeDinner",
  SNACK: "mealTypeSnack",
};

// Opened from the "Cook now" tab (see cook-now-list.tsx), which — unlike the
// week planner's own MealEntryDialog — has no day/slot the recipe is already
// scoped to, so date and meal type are picked here instead of arriving as
// fixed hidden inputs. Reuses addMealEntryAction directly; the week the entry
// lands in is derived from the picked date rather than the week currently
// shown in the Planner tab, so a date outside that week won't appear there
// until the user navigates to it — the success toast below calls that out
// explicitly (with a shortcut straight there) whenever it happens. See D3 in
// UX_AUDIT_IMPLEMENTATION_PLAN.md.
export function AddToPlanDialog({
  dict,
  recipeId,
  recipeName,
  defaultPortions,
  plannerWeekStartKey,
}: {
  dict: MealPlanningDict;
  recipeId: string;
  recipeName: string;
  defaultPortions: number;
  plannerWeekStartKey: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => toDateKey(new Date()));
  const [mealType, setMealType] = useState<MealType>("DINNER");
  const [portions, setPortions] = useState(String(defaultPortions));

  const weekStartKey = toDateKey(getWeekStart(parseDateKey(date)));

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await addMealEntryAction(prevState, formData);
    if (!result.error) {
      setOpen(false);
      if (weekStartKey === plannerWeekStartKey) {
        toast.success(format(dict.addedToPlanToast, { recipe: recipeName }));
      } else {
        toast.success(format(dict.addedToPlanDifferentWeekToast, { recipe: recipeName }), {
          action: {
            label: dict.viewThatWeek,
            onClick: () => router.push(`/dashboard/meal-planning?week=${weekStartKey}`),
          },
        });
      }
    }
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <CalendarPlus className="size-4" />
            {dict.addToPlanButton}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(dict.addToPlanDialogTitle, { recipe: recipeName })}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="recipeId" value={recipeId} />
          <input type="hidden" name="weekStartDate" value={weekStartKey} />
          <input type="hidden" name="mealType" value={mealType} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="add-to-plan-date">{dict.dateLabel}</Label>
            <Input
              id="add-to-plan-date"
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
            <Label htmlFor="add-to-plan-meal-type">{dict.mealTypeLabel}</Label>
            <Select value={mealType} onValueChange={(v) => setMealType((v as MealType) ?? "DINNER")}>
              <SelectTrigger id="add-to-plan-meal-type" className="w-full">
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="add-to-plan-portions">{dict.portionsLabel}</Label>
            <Input
              id="add-to-plan-portions"
              name="portions"
              type="number"
              min={1}
              max={1000}
              step={1}
              value={portions}
              onChange={(e) => setPortions(e.target.value)}
              className="w-24"
            />
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? dict.adding : dict.addToPlanSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
