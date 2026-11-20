"use client";

import { useState, useTransition, type DragEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, CheckCircle2, ChefHat, ChevronRight, CookingPot, Loader2, Pencil, StickyNote, Trash2, Undo2, Unlink, Utensils } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { MissingDietBadges } from "@/components/meal-planning/missing-diet-badges";
import type { RecipeTag } from "@/lib/recipe-tags";
import { Button } from "@/components/ui/button";
import { useUndoableDelete } from "@/components/shared/use-undoable-delete";
import { Checkbox } from "@/components/ui/checkbox";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogHandle,
} from "@/components/ui/dialog";
import { LazyDialog, openLazyDialog } from "@/components/ui/lazy-dialog";
import {
  loadCookModeDialog,
  loadMarkCookedDialog,
  loadMealEntryDialog,
  loadMoveMealDialog,
} from "@/components/meal-planning/lazy-dialogs";
import type { PlanLeftoversRequest } from "@/components/meal-planning/mark-cooked-dialog";
import { mealTypeDictKey, type MealPlanningDict } from "@/components/meal-planning/week-planner-helpers";
import { deleteMealEntryAction } from "@/app/dashboard/meal-planning/planner-actions";
import { unassignBatchPortionAction } from "@/app/dashboard/meal-planning/prep-actions";
import { format, plural } from "@/lib/i18n/format";
import type { MealPlanEntryData, RecipeData } from "@/components/meal-planning/types";
import type { Locale } from "@/lib/i18n/locales";

// One planned meal: a single tappable row (slot, name, portions, status)
// that opens a sheet of labelled actions. It used to carry five unlabelled
// 44 px icon buttons on a second line, delete right beside "mark cooked"
// (DESIGN.md M2, M6). The sheet hands off to each action's own dialog
// through a handle, the same way the shopping list's ⋯ menu does, so those
// dialogs live beside the sheet rather than inside it.
export function MealEntryRow({
  dict,
  locale,
  entry,
  dayLabel,
  recipes,
  requiredTags,
  weekStartKey,
  onPlanLeftovers,
  selectMode,
  selected,
  onToggleSelected,
  onBackToPicks,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  entry: MealPlanEntryData;
  dayLabel: string;
  recipes: RecipeData[];
  requiredTags: RecipeTag[];
  weekStartKey: string;
  onPlanLeftovers: (request: PlanLeftoversRequest) => void;
  // GAP-56: in Select mode the row is a checkbox instead of a sheet opener.
  selectMode: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
  // Week picks: "Back to picks" in the row's sheet, and (desktop) dragging
  // the row to another day or back to the tray.
  // Absent on a week that's over.
  onBackToPicks?: (entry: MealPlanEntryData, label: string) => void;
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const label = entry.recipeName ?? entry.freeformName ?? "";
  const slotLabel = dict[mealTypeDictKey[entry.mealType]];
  const linkedRecipe = entry.recipeId ? recipes.find((recipe) => recipe.id === entry.recipeId) : undefined;
  const cookRecipe = linkedRecipe?.instructions?.trim() ? linkedRecipe : null;
  // Portions only mean something next to a linked recipe — a freeform entry
  // has nothing to scale (see MealPlanEntryData.portions' doc comment).
  const portionsLabel = entry.recipeId
    ? format(plural(entry.portions, dict.entryPortionsCount), { count: entry.portions })
    : null;
  const cooked = entry.consumedAt !== null;
  const prepped = entry.preparedBatchId !== null;
  const [unassignPending, startUnassign] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  // UX-49: Remove meal hides the row at once with an Undo toast (the delete
  // goes out when it closes), not a "can't be undone" confirm.
  const { hidden, remove } = useUndoableDelete({
    run: async () =>
      (await settleOptimisticAction(() => deleteMealEntryAction(entry.id), dict.prepConnectionError)) !== null,
    message: format(dict.mealRemovedToast, { meal: label }),
    undoLabel: dict.undoDelete,
  });
  const [dialogs] = useState(() => ({
    cook: createDialogHandle(),
    markCooked: createDialogHandle(),
    edit: createDialogHandle(),
    move: createDialogHandle(),
  }));

  // The sheet closes as the chosen action's dialog opens over the page, so
  // closing that dialog lands back on the planner, not on a stale sheet.
  function openFromSheet(handle: DialogHandle) {
    setSheetOpen(false);
    openLazyDialog(handle);
  }

  // GAP-49: "Don't use prep" gives the slot's portions back to its batch and
  // keeps the meal planned, to cook fresh.
  function unassign() {
    startUnassign(async () => {
      let result;
      try {
        result = await unassignBatchPortionAction(entry.id);
      } catch (error) {
        // A dropped connection rejects the call; say so rather than hitting
        // the error boundary (M8), as the Plan portions dialog does.
        unstable_rethrow(error);
        toast.error(dict.prepConnectionError);
        return;
      }
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(dict.prepUnassignedToast);
      setSheetOpen(false);
      // No router.refresh(): the action revalidated the page and its
      // response already carries the re-render.
    });
  }

  if (hidden) return null;

  const rowBody = (
    <>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-xs font-medium uppercase text-muted-foreground">{slotLabel}</span>{" "}
      <span className="break-words">
        <span>{label}</span>
        {portionsLabel && <span className="text-muted-foreground"> · {portionsLabel}</span>}
      </span>
      {/* GAP-71: a warning in words, wrapping under the name; never blocks. */}
      {linkedRecipe && requiredTags.length > 0 && (
        <span className="flex flex-wrap gap-1 pt-0.5">
          <MissingDietBadges dict={dict} recipeTags={linkedRecipe.tags} requiredTags={requiredTags} />
        </span>
      )}
      {/* GAP-81: one muted line, cut short here; the row's sheet has it in
          full (M9), so nothing depends on a hover `title`. */}
      {entry.note && (
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
          <StickyNote className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">{dict.mealNoteHeading}</span>
          <span className="truncate">{entry.note}</span>
        </span>
      )}
    </span>
    {/* Words, not just a colour or an icon, so the state reads the
        same to everyone (GAP-49's badge, the cooked tick). */}
    {prepped && (
      <Badge variant="outline" className="shrink-0">
        {dict.prepPreppedBadge}
      </Badge>
    )}
    {/* A prepped meal was cooked at prep time, so what this records is
        that it was eaten (as its "Mark as eaten" button says). */}
    {cooked && (
      <span className="flex shrink-0 items-center gap-1 text-xs text-success">
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        {prepped ? dict.mealEatenBadgeLabel : dict.mealCookedBadgeLabel}
      </span>
    )}
    </>
  );

  if (selectMode) {
    if (cooked) {
      // Cooked meals aren't selectable: their day, slot and portions record
      // what was eaten (see bulk-meal-actions.ts). Said in words, not only
      // by being dimmed.
      return (
        <div className="flex min-h-11 w-full items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-sm text-muted-foreground">
          {rowBody}
          <span className="sr-only">{prepped ? dict.bulkEatenLocked : dict.bulkCookedLocked}</span>
        </div>
      );
    }
    return (
      <label className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md bg-muted px-2 py-1.5 text-sm transition-colors has-[:checked]:bg-accent has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
        <Checkbox checked={selected} onChange={() => onToggleSelected(entry.id)} />
        {rowBody}
      </label>
    );
  }

  return (
    <>
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              // A cooked meal stays put (its day is a record), as in Move.
              draggable={draggable && !cooked ? true : undefined}
              onDragStart={draggable && !cooked ? onDragStart : undefined}
              onDragEnd={draggable && !cooked ? onDragEnd : undefined}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-left text-sm transition-[background-color,scale] outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]",
                draggable && !cooked && "cursor-grab active:cursor-grabbing",
              )}
            />
          }
        >
          {rowBody}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-words">{label}</DialogTitle>
            <DialogDescription>
              {[slotLabel, dayLabel, portionsLabel].filter(Boolean).join(" · ")}
            </DialogDescription>
          </DialogHeader>
          {/* GAP-81: the whole note, wrapped. */}
          {entry.note && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm break-words">
              <span className="block text-xs font-medium uppercase text-muted-foreground">
                {dict.mealNoteHeading}
              </span>
              {entry.note}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {/* Cooking it is what a planned meal is waiting for, so it's the
                sheet's one primary action. Custom (non-recipe) meals have no
                ingredients to take off, so they say why instead (D4 in
                docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md). */}
            {!cooked && entry.recipeId && (
              <Button type="button" className="justify-start" onClick={() => openFromSheet(dialogs.markCooked)}>
                {prepped ? <Utensils className="size-4" /> : <ChefHat className="size-4" />}
                {prepped ? dict.prepEatenAction : dict.markCookedAriaLabel}
              </Button>
            )}
            {/* GAP-42: the cook view scaled to this entry's portions. Not
                gated on cooked: reading a recipe again is harmless. */}
            {cookRecipe && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => openFromSheet(dialogs.cook)}
              >
                <CookingPot className="size-4" />
                {dict.cookModeButton}
              </Button>
            )}
            {/* GAP-30: hidden once cooked. A cooked entry's day and slot
                record when it was actually eaten, so moveMealEntryAction
                refuses to move it (see its doc comment). */}
            {!cooked && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start"
                  onClick={() => openFromSheet(dialogs.edit)}
                >
                  <Pencil className="size-4" />
                  {dict.editMealAriaLabel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start"
                  onClick={() => openFromSheet(dialogs.move)}
                >
                  <ArrowRightLeft className="size-4" />
                  {dict.moveMealAriaLabel}
                </Button>
              </>
            )}
            {/* Week picks: back to the tray rather than deleted, for a busy
                evening. Not for a cooked meal (a record) or a prepped one
                (it holds batch portions a pick can't keep). */}
            {onBackToPicks && !cooked && !prepped && (entry.recipeId || entry.freeformName) && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => {
                  setSheetOpen(false);
                  requestAnimationFrame(() => onBackToPicks?.(entry, label));
                }}
              >
                <Undo2 className="size-4" />
                {dict.weekPicks.backToPicks}
              </Button>
            )}
            {prepped && !cooked && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                disabled={unassignPending}
                onClick={unassign}
              >
                {unassignPending ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
                {dict.prepUnassignAction}
              </Button>
            )}
            {!entry.recipeId && (
              <p className="text-sm text-muted-foreground">{dict.markCookedUnavailableForCustomMeal}</p>
            )}
          </div>
          {/* M2: the destructive action sits apart, under a rule, never
              next to the primary one. */}
          <div className="border-t pt-4">
            <Button
              type="button"
              variant="destructive"
              className="w-full justify-start"
              onClick={() => {
                setSheetOpen(false);
                // After the sheet has closed, so it unmounts shut.
                requestAnimationFrame(remove);
              }}
            >
              <Trash2 className="size-4" />
              {dict.removeMealAriaLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* PERF-26: each row's dialogs load on first use. */}
      {cookRecipe && (
        <LazyDialog loader={loadCookModeDialog} handle={dialogs.cook}>
          {(CookMode) => (
            <CookMode
              dict={dict}
              locale={locale}
              recipe={cookRecipe}
              portions={entry.portions}
              note={entry.note}
              handle={dialogs.cook}
              onDone={!cooked && entry.recipeId ? () => openLazyDialog(dialogs.markCooked) : undefined}
            />
          )}
        </LazyDialog>
      )}
      {!cooked && entry.recipeId && (
        <LazyDialog loader={loadMarkCookedDialog} handle={dialogs.markCooked}>
          {(MarkCooked) => (
            <MarkCooked dict={dict} entry={entry} onPlanLeftovers={onPlanLeftovers} handle={dialogs.markCooked} />
          )}
        </LazyDialog>
      )}
      {!cooked && (
        <>
          <LazyDialog loader={loadMealEntryDialog} handle={dialogs.edit}>
            {(MealEntry) => <MealEntry dict={dict} recipes={recipes} mode="edit" entry={entry} handle={dialogs.edit} />}
          </LazyDialog>
          <LazyDialog loader={loadMoveMealDialog} handle={dialogs.move}>
            {(MoveMeal) => (
              <MoveMeal
                dict={dict}
                entry={entry}
                label={label}
                plannerWeekStartKey={weekStartKey}
                handle={dialogs.move}
              />
            )}
          </LazyDialog>
        </>
      )}
    </>
  );
}
