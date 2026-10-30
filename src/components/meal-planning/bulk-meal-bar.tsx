"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, Trash2, UsersRound, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PendingLabel } from "@/components/ui/pending-label";
import { PortionStepper } from "@/components/meal-planning/portion-stepper";
import {
  bulkEditMealEntriesAction,
  undoBulkMarkEatenAction,
  undoBulkMealEditAction,
  type BulkMealEdit,
  type BulkMealResult,
} from "@/app/dashboard/meal-planning/bulk-meal-actions";
import { canMarkEaten, canRePortion } from "@/app/dashboard/meal-planning/bulk-meal-calc";
import type { ActionState } from "@/lib/actions/auth";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { format, plural } from "@/lib/i18n/format";
import type { MealPlanEntryData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

type MealTypeLabelKey = "mealTypeBreakfast" | "mealTypeLunch" | "mealTypeDinner" | "mealTypeSnack";

const mealTypeDictKey: Record<MealType, MealTypeLabelKey> = {
  BREAKFAST: "mealTypeBreakfast",
  LUNCH: "mealTypeLunch",
  DINNER: "mealTypeDinner",
  SNACK: "mealTypeSnack",
};

const KEEP_SLOT = "KEEP";

// GAP-56: the bar Select mode shows once meals are ticked. On a phone it is
// docked to the top of the bottom bar so a thumb reaches its actions without
// scrolling back up (DESIGN.md M2), on the same `fixed` footing as the
// inventory's bulk bar (UX-123). It used to be `sticky`, which iOS Safari
// left floating over the middle of the list. `data-bulk-bar="meals"` makes
// <main> reserve its height (globals.css), so the last day still scrolls out
// from under it. Each button is 44 px high (M3) and Remove sits in its own
// cell, in the corner away from Mark eaten (M2). Mark eaten runs at once;
// Move and Portions open a dialog first. All three toast with Undo (M7:
// changing data is undoable). Remove is handed to the planner, which hides
// the rows and sends the delete when the toast closes, like a single Remove
// meal (UX-49).
export function BulkMealBar({
  dict,
  selected,
  onDone,
  onRemove,
  onChanged,
}: {
  dict: MealPlanningDict;
  selected: MealPlanEntryData[];
  onDone: () => void;
  onRemove: () => void;
  /** After a move or portions change went through: leave Select mode. */
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<"move" | "portions" | null>(null);
  const [eating, startEating] = useTransition();
  const count = selected.length;
  const none = count === 0;
  // Only meals from meal prep can be marked eaten in bulk (canMarkEaten), so
  // the button is off until one is ticked rather than failing on tap.
  const noneEatable = !selected.some(canMarkEaten);

  // Undo is tapped on the same flaky links as the edit, so a rejected call
  // gets the same toast instead of an unhandled rejection (M8).
  async function undo(call: () => Promise<ActionState>) {
    try {
      const undone = await call();
      if (undone.error) toast.error(undone.error);
      else toast.success(dict.bulkUndoneToast);
    } catch (error) {
      unstable_rethrow(error);
      toast.error(dict.prepConnectionError);
    }
  }

  // One call that runs a bulk edit, toasts the outcome with an Undo, and
  // returns whether it went through. A dropped connection rejects the call;
  // say so rather than hitting the error boundary (M8).
  async function run(
    edit: BulkMealEdit,
    message: (n: number) => string,
    skippedNote: { one: string; other: string } = dict.bulkSkippedNote,
  ): Promise<boolean> {
    let result: BulkMealResult;
    try {
      result = await bulkEditMealEntriesAction(edit);
    } catch (error) {
      unstable_rethrow(error);
      toast.error(dict.prepConnectionError);
      return false;
    }
    if (result.error) {
      toast.error(result.error);
      return false;
    }
    const restore = result.restore ?? [];
    const eatenIds = result.eatenIds;
    const skipped = result.skipped ?? 0;
    toast.success(message(result.changed ?? 0), {
      duration: 8000,
      description: skipped > 0 ? format(plural(skipped, skippedNote), { count: skipped }) : undefined,
      action: {
        label: dict.undoDelete,
        onClick: () => {
          void undo(() => (eatenIds ? undoBulkMarkEatenAction(eatenIds) : undoBulkMealEditAction(restore)));
        },
      },
    });
    onChanged();
    return true;
  }

  function markEaten() {
    startEating(async () => {
      await run(
        { op: "eaten", entryIds: selected.map((e) => e.id) },
        (n) => format(plural(n, dict.bulkEatenToast), { count: n }),
        dict.bulkEatenSkippedNote,
      );
    });
  }

  return (
    <div
      role="region"
      aria-label={dict.bulkBarLabel}
      data-bulk-bar="meals"
      className="z-30 flex flex-col gap-2 border bg-background/95 p-3 shadow-lg backdrop-blur-sm max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[calc(var(--bottom-nav-h)+var(--cookie-notice-h,0px))] max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 max-sm:bg-background max-sm:pr-[max(1rem,env(safe-area-inset-right))] max-sm:pl-[max(1rem,env(safe-area-inset-left))] sm:sticky sm:bottom-4 sm:rounded-xl print:hidden"
    >
      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" className="min-w-0 flex-1 text-sm font-medium">
          {none ? dict.bulkSelectHint : format(plural(count, dict.bulkSelectedCount), { count })}
        </p>
        <Button type="button" variant="ghost" className="max-sm:h-11" onClick={onDone}>
          {dict.bulkDone}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 whitespace-normal"
          disabled={noneEatable || eating}
          onClick={markEaten}
        >
          <Utensils className="size-4 shrink-0" aria-hidden="true" />
          {dict.bulkMarkEaten}
        </Button>
        <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={none} onClick={() => setDialog("move")}>
          <ArrowRightLeft className="size-4 shrink-0" aria-hidden="true" />
          {dict.bulkMove}
        </Button>
        <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={none} onClick={() => setDialog("portions")}>
          <UsersRound className="size-4 shrink-0" aria-hidden="true" />
          {dict.bulkPortions}
        </Button>
        <Button type="button" variant="destructive" className="h-auto min-h-11 whitespace-normal" disabled={none} onClick={onRemove}>
          <Trash2 className="size-4 shrink-0" aria-hidden="true" />
          {dict.bulkRemove}
        </Button>
      </div>
      {dialog === "move" && (
        <BulkMoveDialog
          dict={dict}
          selected={selected}
          onClose={() => setDialog(null)}
          onSubmit={(date, mealType) =>
            run({ op: "move", entryIds: selected.map((e) => e.id), date, mealType }, (n) =>
              format(plural(n, dict.bulkMovedToast), { count: n }),
            )
          }
        />
      )}
      {dialog === "portions" && (
        <BulkPortionsDialog
          dict={dict}
          selected={selected}
          onClose={() => setDialog(null)}
          onSubmit={(portions) =>
            run({ op: "portions", entryIds: selected.map((e) => e.id), portions }, (n) =>
              format(plural(n, dict.bulkPortionsToast), { count: n }),
            )
          }
        />
      )}
    </div>
  );
}

function BulkMoveDialog({
  dict,
  selected,
  onClose,
  onSubmit,
}: {
  dict: MealPlanningDict;
  selected: MealPlanEntryData[];
  onClose: () => void;
  onSubmit: (date: string, mealType: MealType | null) => Promise<boolean>;
}) {
  const earliest = selected.reduce((min, e) => (e.date < min ? e.date : min), selected[0].date);
  const [date, setDate] = useState(earliest);
  const [slot, setSlot] = useState<string>(KEEP_SLOT);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const ok = await onSubmit(date, slot === KEEP_SLOT ? null : (slot as MealType));
      if (ok) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.bulkMoveTitle}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{dict.bulkMoveHint}</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-move-date">{dict.dateLabel}</Label>
            <Input
              id="bulk-move-date"
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-move-slot">{dict.mealTypeLabel}</Label>
            <Select value={slot} onValueChange={(v) => setSlot(v ?? KEEP_SLOT)}>
              <SelectTrigger id="bulk-move-slot" className="w-full">
                <SelectValue>
                  {slot === KEEP_SLOT ? dict.bulkMoveKeepSlot : dict[mealTypeDictKey[slot as MealType]]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP_SLOT}>{dict.bulkMoveKeepSlot}</SelectItem>
                {MEAL_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {dict[mealTypeDictKey[type]]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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

function BulkPortionsDialog({
  dict,
  selected,
  onClose,
  onSubmit,
}: {
  dict: MealPlanningDict;
  selected: MealPlanEntryData[];
  onClose: () => void;
  onSubmit: (portions: number) => Promise<boolean>;
}) {
  // Starts from the first meal that can be re-portioned, so a "halve
  // everything" is a tap or two away from where the group already is.
  const first = selected.find(canRePortion) ?? selected[0];
  const [portions, setPortions] = useState(first.portions);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const ok = await onSubmit(portions);
      if (ok) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.bulkPortionsTitle}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{dict.bulkPortionsHint}</p>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{dict.portionsLabel}</span>
            <PortionStepper
              value={portions}
              min={1}
              max={1000}
              onChange={setPortions}
              label={dict.portionsLabel}
              decreaseLabel={dict.prepDecreasePortions}
              increaseLabel={dict.prepIncreasePortions}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              <PendingLabel pending={pending} busy={dict.saving} idle={dict.bulkPortionsSubmit} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
