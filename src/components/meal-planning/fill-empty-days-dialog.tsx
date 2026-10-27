"use client";

import { useState, useTransition } from "react";
import { Shuffle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fillEmptyDaysAction, undoCopyWeekAction } from "@/app/dashboard/meal-planning/planner-actions";
import { type DinnerProposal, nextSwap, proposeDinners } from "@/app/dashboard/meal-planning/fill-empty-days";
import { format, plural } from "@/lib/i18n/format";
import type { RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

export type EmptyDay = { dateKey: string; label: string };

// GAP-45: proposes a dinner for each day with nothing planned, as a preview,
// from the household's favorites first and then its other recipes (UX-97). The
// proposal is computed here from data the page already loaded and lives only
// in this component's state, so nothing is written until "Add dinners".
// Swapping a row walks to the next unused recipe (nextSwap), so the no-repeat
// rule holds without a free-form picker; Cancel (or closing) discards the lot. Accepting calls
// fillEmptyDaysAction, which re-validates everything, and offers the same
// by-id Undo that "Copy last week" has. Opened from the planner's ⋯ menu so
// the control row stays one row on a phone (UX-21).
export function FillEmptyDaysDialog({
  dict,
  weekStartKey,
  emptyDays,
  recipes,
  plannedRecipeIds,
  onClose,
}: {
  dict: MealPlanningDict;
  weekStartKey: string;
  emptyDays: EmptyDay[];
  recipes: RecipeData[];
  plannedRecipeIds: string[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const recipeName = new Map(recipes.map((r) => [r.id, r.name]));
  const planned = new Set(plannedRecipeIds);

  // Mounted only while open (the planner's ⋯ menu item opens it), so the
  // proposal is made fresh from the week as it is now on every open and a
  // cancelled preview never lingers.
  const [proposal, setProposal] = useState<DinnerProposal[]>(() =>
    proposeDinners({ emptyDays: emptyDays.map((d) => d.dateKey), recipes, plannedRecipeIds: planned }),
  );

  function swap(dateKey: string) {
    setProposal((rows) => {
      const used = new Set([...planned, ...rows.map((r) => r.recipeId)]);
      return rows.map((row) => {
        if (row.dateKey !== dateKey) return row;
        const replacement = nextSwap({ currentId: row.recipeId, recipes, usedRecipeIds: used });
        return replacement ? { ...row, recipeId: replacement } : row;
      });
    });
  }

  function accept() {
    startTransition(async () => {
      const result = await fillEmptyDaysAction(
        weekStartKey,
        proposal.map((p) => ({ date: p.dateKey, recipeId: p.recipeId })),
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      onClose();
      const entryIds = result.entryIds ?? [];
      if (entryIds.length === 0) {
        toast(dict.fillEmptyDaysNothingToast);
        return;
      }
      toast.success(format(plural(entryIds.length, dict.fillEmptyDaysToast), { count: entryIds.length }), {
        duration: 8000,
        action: {
          label: dict.fillEmptyDaysUndo,
          onClick: () => {
            void undoCopyWeekAction(entryIds).then((undoResult) => {
              if (undoResult.error) toast.error(undoResult.error);
              else {
                // No router.refresh(): the undo action revalidated the page.
                toast.success(dict.fillEmptyDaysUndoneToast);
              }
            });
          },
        },
      });
    });
  }

  const dayLabel = new Map(emptyDays.map((d) => [d.dateKey, d.label]));
  const noRecipes = recipes.length === 0;
  const noneLeft = !noRecipes && proposal.length === 0;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.fillEmptyDays}</DialogTitle>
          <DialogDescription>{dict.fillEmptyDaysDescription}</DialogDescription>
        </DialogHeader>

        {noRecipes && <p className="text-sm text-muted-foreground">{dict.fillEmptyDaysNoRecipes}</p>}
        {noneLeft && <p className="text-sm text-muted-foreground">{dict.fillEmptyDaysNoneLeft}</p>}

        {proposal.length > 0 && (
          <ul className="flex flex-col gap-2">
            {proposal.map((row) => {
              const label = dayLabel.get(row.dateKey) ?? row.dateKey;
              const used = new Set([...planned, ...proposal.map((r) => r.recipeId)]);
              const canSwap = nextSwap({ currentId: row.recipeId, recipes, usedRecipeIds: used }) !== null;
              return (
                <li key={row.dateKey} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">{label}</span>
                  <span className="min-w-0 flex-1 break-words text-sm font-medium">
                    {recipeName.get(row.recipeId)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    disabled={!canSwap || pending}
                    aria-label={format(dict.fillEmptyDaysSwapAriaLabel, { day: label })}
                    onClick={() => swap(row.dateKey)}
                  >
                    <Shuffle className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {proposal.length > 0 && proposal.length < emptyDays.length && (
          <p className="text-sm text-muted-foreground">{dict.fillEmptyDaysShort}</p>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>{dict.fillEmptyDaysCancel}</DialogClose>
          <Button type="button" disabled={proposal.length === 0 || pending} onClick={accept}>
            {dict.fillEmptyDaysSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
