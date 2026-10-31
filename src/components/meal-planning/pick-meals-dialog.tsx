"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Clock, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PendingLabel } from "@/components/ui/pending-label";
import { PortionStepper } from "@/components/meal-planning/portion-stepper";
import { orderRecipesForPicker } from "@/components/meal-planning/recipe-picker-order";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { splitCookSoon } from "@/app/dashboard/meal-planning/cook-soon";
import { addPicksAction, undoAddPicksAction } from "@/app/dashboard/meal-planning/pick-actions";
import type { RecipeCookedStats } from "@/app/dashboard/meal-planning/recipe-cooked-stats";
import { format, plural } from "@/lib/i18n/format";
import type { RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

const MAX_PORTIONS = 99;

// Week picks' multi-select picker ("Pick meals"): tick several recipes at
// once, each with its own portions, plus custom meals, then one "Add N
// meals" at the bottom of the sheet (sticky, M2). Cook soon first (the
// "I want to make this soon" queue is what a week's picks are made from),
// then favourites, then everything else, most recently cooked first. The
// planner mounts it only while open, like the missing-ingredients review.
export function PickMealsDialog({
  dict,
  weekLabel,
  weekStartKey,
  recipes,
  recipeCooked,
  pickedRecipeIds,
  onClose,
}: {
  dict: MealPlanningDict;
  weekLabel: string;
  weekStartKey: string;
  recipes: RecipeData[];
  recipeCooked: Record<string, RecipeCookedStats>;
  /** Recipes already in the tray, captioned "Already picked". */
  pickedRecipeIds: ReadonlySet<string>;
  onClose: () => void;
}) {
  const wp = dict.weekPicks;
  const [query, setQuery] = useState("");
  // Ticked recipes and their portions, in the order they were ticked.
  const [selected, setSelected] = useState<ReadonlyMap<string, number>>(new Map());
  const [customs, setCustoms] = useState<{ key: number; name: string }[]>([]);
  const [customName, setCustomName] = useState("");
  const [pending, startTransition] = useTransition();

  const needle = query.trim().toLocaleLowerCase();
  const matching = needle ? recipes.filter((r) => r.name.toLocaleLowerCase().includes(needle)) : recipes;
  const { shelf, rest } = splitCookSoon(matching);
  const ordered = orderRecipesForPicker(rest, recipeCooked);
  const groups = [
    { key: "soon", label: wp.pickerCookSoon, icon: Clock, rows: shelf },
    { key: "fav", label: wp.pickerFavourites, icon: Star, rows: ordered.filter((r) => r.isFavorite) },
    { key: "all", label: wp.pickerAllRecipes, icon: null, rows: ordered.filter((r) => !r.isFavorite) },
  ].filter((group) => group.rows.length > 0);

  const count = selected.size + customs.length;

  function toggle(recipe: RecipeData) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(recipe.id)) next.delete(recipe.id);
      else next.set(recipe.id, Math.min(recipe.servings, MAX_PORTIONS));
      return next;
    });
  }

  function setPortions(recipeId: string, portions: number) {
    setSelected((prev) => new Map(prev).set(recipeId, portions));
  }

  function addCustom() {
    const name = customName.trim().slice(0, 120);
    if (!name) return;
    setCustoms((prev) => [...prev, { key: Date.now(), name }]);
    setCustomName("");
  }

  function onCustomKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addCustom();
  }

  function submit() {
    if (count === 0) return;
    const picks = [
      ...[...selected].map(([recipeId, portions]) => ({ recipeId, portions })),
      ...customs.map((custom) => ({ freeformName: custom.name, portions: 4 })),
    ];
    startTransition(async () => {
      const result = await settleOptimisticAction(
        () => addPicksAction(weekStartKey, picks),
        dict.prepConnectionError,
      );
      if (!result) return;
      const pickIds = result.pickIds ?? [];
      toast.success(format(plural(pickIds.length, wp.addedToast), { count: pickIds.length }), {
        duration: 8000,
        action: {
          label: wp.undo,
          onClick: () => {
            void settleOptimisticAction(() => undoAddPicksAction(pickIds), dict.prepConnectionError);
          },
        },
      });
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} longForm>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(wp.pickerTitle, { week: weekLabel })}</DialogTitle>
          <DialogDescription>{wp.pickerHint}</DialogDescription>
        </DialogHeader>

        <SearchInput
          value={query}
          onValueChange={setQuery}
          clearLabel={dict.clearSearch}
          placeholder={wp.pickerSearch}
          aria-label={wp.pickerSearch}
          autoComplete="off"
          enterKeyHint="search"
        />

        {groups.length === 0 && needle && <p className="text-sm text-muted-foreground">{wp.pickerNoMatches}</p>}

        {groups.map((group) => (
          <section key={group.key} aria-label={group.label} className="flex flex-col gap-1">
            <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground">
              {group.icon && <group.icon className="size-3.5" aria-hidden="true" />}
              {group.label}
            </h3>
            {group.rows.map((recipe) => {
              const portions = selected.get(recipe.id);
              const checked = portions !== undefined;
              return (
                <div
                  key={recipe.id}
                  className="flex min-h-13 items-center gap-2 rounded-lg px-2 py-1 transition-colors has-[:checked]:bg-accent"
                >
                  <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <Checkbox checked={checked} onChange={() => toggle(recipe)} />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium break-words">{recipe.name}</span>
                      {pickedRecipeIds.has(recipe.id) && (
                        <span className="text-xs text-muted-foreground">{wp.pickerAlreadyPicked}</span>
                      )}
                    </span>
                  </label>
                  {checked && (
                    <PortionStepper
                      value={portions}
                      min={1}
                      max={MAX_PORTIONS}
                      onChange={(value) => setPortions(recipe.id, value)}
                      label={format(wp.portionsOf, { name: recipe.name })}
                      decreaseLabel={format(wp.fewerPortions, { name: recipe.name })}
                      increaseLabel={format(wp.morePortions, { name: recipe.name })}
                    />
                  )}
                </div>
              );
            })}
          </section>
        ))}

        <section aria-label={wp.pickerCustom} className="flex flex-col gap-1">
          <h3 className="px-1 text-xs font-semibold text-muted-foreground">{wp.pickerCustom}</h3>
          {customs.map((custom) => (
            <label
              key={custom.key}
              className="flex min-h-13 cursor-pointer items-center gap-3 rounded-lg bg-accent px-2 py-1"
            >
              <Checkbox
                checked
                onChange={() => setCustoms((prev) => prev.filter((c) => c.key !== custom.key))}
              />
              <span className="min-w-0 font-medium break-words">{custom.name}</span>
            </label>
          ))}
          <div className="flex gap-2">
            <Input
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              onKeyDown={onCustomKeyDown}
              aria-label={wp.pickerCustomName}
              placeholder={wp.pickerCustomPlaceholder}
              maxLength={120}
              autoComplete="off"
              enterKeyHint="done"
              className="min-w-0 flex-1"
            />
            <Button type="button" variant="outline" onClick={addCustom} disabled={!customName.trim()}>
              {wp.pickerCustomAdd}
            </Button>
          </div>
        </section>

        <DialogFooter>
          <Button type="button" className="w-full sm:w-auto" disabled={count === 0 || pending} onClick={submit}>
            <PendingLabel
              pending={pending}
              busy={dict.adding}
              idle={count === 0 ? wp.pickerSubmitNone : format(plural(count, wp.pickerSubmit), { count })}
            />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
