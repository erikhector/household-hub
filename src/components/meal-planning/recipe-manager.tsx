"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, CookingPot, Copy, Layers, ListChecks, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RECIPE_TAGS, isRecipeTag, recipeMatchesTag } from "@/lib/recipe-tags";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { PrimaryAction } from "@/components/dashboard/primary-action";
import { formatCookQuantity } from "@/lib/cook-mode-calc";
import { CookModeDialog } from "@/components/meal-planning/cook-mode-dialog";
import { RecipeFormDialog } from "@/components/meal-planning/recipe-form-dialog";
import { UseItUpSuggestions } from "@/components/meal-planning/use-it-up-suggestions";
import { deleteRecipeAction, toggleRecipeFavoriteAction } from "@/app/dashboard/meal-planning/recipe-actions";
import { cn } from "@/lib/utils";
import { format, plural } from "@/lib/i18n/format";
import type { RecipeData, UseItUpSuggestionData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import type { RecipeCost } from "@/app/dashboard/meal-planning/recipe-cost";
import { createMoneyFormat } from "@/lib/currency";
import type { RecipeCookedStats } from "@/app/dashboard/meal-planning/recipe-cooked-stats";
import { formatRecipeText } from "@/lib/recipe-text";
import { useUnitLabel } from "@/components/units-provider";
import { itemPageHref } from "@/lib/inventory/item-page-origin";

type MealPlanningDict = Dictionary["mealPlanning"];

// Tag filter's "no filter" value — a sentinel that can't collide with a
// RecipeTag key, same as inventory-client.tsx's.
const ALL = "__all__";

function matchesQuery(recipe: RecipeData, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (recipe.name.toLowerCase().includes(q)) return true;
  if (recipe.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(q))) return true;
  return recipe.components.some((component) =>
    component.componentRecipeName.toLowerCase().includes(q),
  );
}

export function RecipeManager({
  dict,
  locale,
  currencyCode,
  recipes,
  recipeCosts,
  recipeCooked,
  useItUpSuggestions,
  ingredientNames,
  ingredientUnits,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
  recipes: RecipeData[];
  // GAP-15: keyed by recipe id. A recipe with no entry had no ingredient
  // that could be priced and shows no cost line — see page.tsx.
  recipeCosts: Record<string, RecipeCost>;
  // GAP-46: keyed by recipe id; a never-cooked recipe has no entry and
  // shows no line.
  recipeCooked: Record<string, RecipeCookedStats>;
  useItUpSuggestions: UseItUpSuggestionData[];
  ingredientNames: string[];
  ingredientUnits: Record<string, string>;
}) {
  // MATCH-6: the item page links a recipe as `?tab=recipes&recipe=<id>`,
  // which opens the list searched down to that recipe.
  const linkedRecipeId = useSearchParams().get("recipe");
  const [query, setQuery] = useState(() => recipes.find((recipe) => recipe.id === linkedRecipeId)?.name ?? "");
  // GAP-29: ALL or one RecipeTag key. Combines with the name search (both
  // must match); vegan implies vegetarian/dairy-free via recipeMatchesTag.
  const [tagFilter, setTagFilter] = useState<string>(ALL);
  // Same formatter as the shopping list's and budget page's amounts:
  // locale-aware two decimals, with the household's currency symbol once
  // one is set (GAP-13). Built once here rather than per row.
  const numberFormat = useMemo(() => createMoneyFormat(locale, currencyCode), [locale, currencyCode]);
  const filteredRecipes = useMemo(
    () =>
      recipes.filter(
        (recipe) =>
          matchesQuery(recipe, query) && (!isRecipeTag(tagFilter) || recipeMatchesTag(recipe.tags, tagFilter)),
      ),
    [recipes, query, tagFilter],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold">{dict.recipesTitle}</h2>
          <p className="text-sm text-muted-foreground">{dict.recipesSubtitle}</p>
        </div>
        {/* M2: on a phone the tab's one primary action floats in thumb
            reach above the bottom bar, like every other page's (UX-40);
            from `sm` it stays here in the header. */}
        <PrimaryAction>
          <RecipeFormDialog
            dict={dict}
            mode="create"
            allRecipes={recipes}
            ingredientNames={ingredientNames}
            ingredientUnits={ingredientUnits}
            trigger={
              <Button type="button">
                <Plus className="size-4" />
                {dict.newRecipe}
              </Button>
            }
          />
        </PrimaryAction>
      </div>

      {recipes.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {dict.emptyRecipes}
        </p>
      ) : (
        <>
          {/* Search + tag filter in one row, the same "all / one value"
              Select the inventory page uses for category and location. Only
              one row's worth of controls, so unlike inventory there's no
              folded mobile "Filters" dialog — both fit side by side. */}
          <div className="flex items-center gap-2">
            <SearchInput
              value={query}
              onValueChange={setQuery}
              placeholder={dict.searchRecipesPlaceholder}
              aria-label={dict.searchRecipesPlaceholder}
              clearLabel={dict.clearSearch}
              containerClassName="min-w-0 flex-1"
            />
            <Select value={tagFilter} onValueChange={(v) => setTagFilter(v ?? ALL)}>
              <SelectTrigger className="w-36 shrink-0 sm:w-44" aria-label={dict.tagFilterLabel}>
                <SelectValue>
                  {(v: string) => (isRecipeTag(v) ? dict.recipeTags[v] : dict.allTags)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{dict.allTags}</SelectItem>
                {RECIPE_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {dict.recipeTags[tag]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {useItUpSuggestions.length > 0 && <UseItUpSuggestions suggestions={useItUpSuggestions} dict={dict} />}

          {filteredRecipes.length === 0 ? (
            <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {dict.noRecipeSearchResults}
            </p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border">
              {filteredRecipes.map((recipe) => (
                <RecipeRow
                  key={recipe.id}
                  dict={dict}
                  locale={locale}
                  recipe={recipe}
                  cost={recipeCosts[recipe.id] ?? null}
                  cooked={recipeCooked[recipe.id] ?? null}
                  numberFormat={numberFormat}
                  allRecipes={recipes}
                  ingredientNames={ingredientNames}
                  ingredientUnits={ingredientUnits}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RecipeRow({
  dict,
  locale,
  recipe,
  cost,
  cooked,
  numberFormat,
  allRecipes,
  ingredientNames,
  ingredientUnits,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  recipe: RecipeData;
  cost: RecipeCost | null;
  cooked: RecipeCookedStats | null;
  numberFormat: Intl.NumberFormat;
  allRecipes: RecipeData[];
  ingredientNames: string[];
  ingredientUnits: Record<string, string>;
}) {
  const [isPending, startTransition] = useTransition();
  const componentSummary = recipe.components.map((component) => component.componentRecipeName).join(", ");
  // Only shown when at least one nutrition field was filled in — see
  // Recipe's doc comment in schema.prisma. Empty recipes (the vast
  // majority, since these fields are optional/manual) render no line here.
  const nutritionParts = [
    recipe.caloriesPerServing != null
      ? format(dict.nutritionCaloriesValue, { value: recipe.caloriesPerServing })
      : null,
    recipe.proteinGramsPerServing != null
      ? format(dict.nutritionProteinValue, { value: recipe.proteinGramsPerServing })
      : null,
    recipe.carbsGramsPerServing != null
      ? format(dict.nutritionCarbsValue, { value: recipe.carbsGramsPerServing })
      : null,
    recipe.fatGramsPerServing != null
      ? format(dict.nutritionFatValue, { value: recipe.fatGramsPerServing })
      : null,
  ].filter((part): part is string => part !== null);
  const nutritionSummary = nutritionParts.join(" · ");
  // GAP-15: hidden (null cost) when no ingredient could be priced, same as
  // the nutrition line above. When some ingredients were skipped the line
  // says how many, so the "~" total reads as the partial estimate it is
  // rather than what the whole recipe costs.
  const costSummary = cost
    ? [
        format(dict.recipeCostValue, {
          total: numberFormat.format(cost.total),
          perServing: numberFormat.format(cost.perServing),
        }),
        cost.skippedCount > 0
          ? format(plural(cost.skippedCount, dict.recipeCostSkipped), { count: cost.skippedCount })
          : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · ")
    : "";

  // GAP-46: "Cooked 3 times, last 12 Sep". consumedAt is an instant, shown
  // as its UTC day like the planner's days, so the server render and every
  // browser name the same date.
  const cookedSummary = cooked
    ? format(plural(cooked.count, dict.recipeCookedValue), {
        count: cooked.count,
        date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
          new Date(cooked.lastCookedAt),
        ),
      })
    : "";

  // GAP-43: plain text on the clipboard, nothing stored or shared. The
  // success toast waits for the write (clipboard.writeText rejects when the
  // page is unfocused or permission is denied), same as CopyLinkButton.
  const unitLabel = useUnitLabel();
  const handleCopyText = async () => {
    const text = formatRecipeText(
      recipe,
      {
        servings: format(plural(recipe.servings, dict.servingsCount), { count: recipe.servings }),
        ingredients: dict.ingredientsLabel,
        instructions: dict.instructionsLabel,
      },
      locale,
      unitLabel,
    );
    try {
      await navigator.clipboard.writeText(text);
      toast.success(dict.copyRecipeTextToast);
    } catch {
      toast.error(dict.copyRecipeTextFailedToast);
    }
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteRecipeAction(recipe.id);
      if (result.error) toast.error(result.error);
    });
  };

  // Star toggle (GAP-18). Its own transition, separate from delete's, so a
  // pending star doesn't grey out the delete button and vice versa. The
  // star flips immediately via useOptimistic and snaps back on its own if
  // the save fails — same pattern as AutoAddSetting — since the optimistic
  // value only lives for the length of the transition and the
  // server-rendered `recipe.isFavorite` is the truth afterwards.
  const [isFavoritePending, startFavoriteTransition] = useTransition();
  const [optimisticFavorite, setOptimisticFavorite] = useOptimistic(recipe.isFavorite);
  const handleToggleFavorite = () => {
    startFavoriteTransition(async () => {
      setOptimisticFavorite(!optimisticFavorite);
      const result = await toggleRecipeFavoriteAction(recipe.id);
      if (result.error) toast.error(result.error);
    });
  };

  const servingsSummary = format(plural(recipe.servings, dict.servingsCount), { count: recipe.servings });
  // The row's one meta line: tags, servings, last cooked. Everything else
  // (ingredients, nutrition, cost) is in the recipe's sheet, so a row is
  // two lines on a phone instead of half a screen (DESIGN.md M6).
  const metaLine = [
    recipe.tags.map((tag) => dict.recipeTags[tag]).join(", "),
    servingsSummary,
    cookedSummary,
  ]
    .filter(Boolean)
    .join(" · ");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogs] = useState(() => ({
    cook: createDialogHandle(),
    edit: createDialogHandle(),
    review: createDialogHandle(),
    remove: createDialogHandle(),
  }));
  // Same hand-off as the planner's meal sheet: the sheet closes as the
  // chosen action's dialog opens, so closing that lands back on the list.
  function openFromSheet(handle: DialogHandle) {
    setSheetOpen(false);
    handle.open(null);
  }

  return (
    <div className="flex items-center gap-1 px-1 py-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn(
          "shrink-0",
          optimisticFavorite ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground",
        )}
        disabled={isFavoritePending}
        aria-pressed={optimisticFavorite}
        aria-label={dict.favoriteAriaLabel}
        title={dict.favoriteAriaLabel}
        onClick={handleToggleFavorite}
      >
        <Star className={cn("size-3.5", optimisticFavorite && "fill-current")} />
      </Button>
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogTrigger
          render={
            <button
              type="button"
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-[background-color,scale] outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
            />
          }
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="line-clamp-2 break-words font-medium">{recipe.name}</span>{" "}
            <span className="truncate text-sm text-muted-foreground">{metaLine}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-words">{recipe.name}</DialogTitle>
            <DialogDescription>
              {servingsSummary}
              {" · "}
              {format(plural(recipe.ingredients.length, dict.ingredientCount), {
                count: recipe.ingredients.length,
              })}
            </DialogDescription>
          </DialogHeader>
          {/* GAP-29: only the tags actually set — recipe.tags is already in
              canonical order (see page.tsx). */}
          {recipe.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {recipe.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {dict.recipeTags[tag]}
                </Badge>
              ))}
            </div>
          )}
          {recipe.ingredients.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="font-medium">{dict.ingredientsLabel}</h3>
              <ul className="flex flex-col gap-1">
                {recipe.ingredients.map((ingredient) => (
                  <li key={ingredient.id} className="break-words">
                    <span className="text-muted-foreground tabular-nums">
                      {formatCookQuantity(ingredient.quantity, 1, locale)}
                      {ingredient.unit ? ` ${unitLabel(ingredient.unit)}` : ""}
                    </span>{" "}
                    {/* MATCH-6: a linked ingredient opens its pantry item's
                        page, whose back arrow comes back to this tab. An
                        imported row's prep note (MATCH-2) reads after its
                        name, the way the recipe had it. */}
                    {ingredient.inventoryItemId ? (
                      <Link
                        href={itemPageHref(ingredient.inventoryItemId, { kind: "recipes" })}
                        data-running-text
                        className="underline underline-offset-4"
                      >
                        {ingredient.name}
                      </Link>
                    ) : (
                      ingredient.name
                    )}
                    {ingredient.note && <span className="text-muted-foreground"> ({ingredient.note})</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* Sub-recipes, nutrition (only when filled in — see Recipe's
              doc comment in schema.prisma), the GAP-15 cost estimate and
              GAP-46's cooked count: each line only when it has something. */}
          {(componentSummary || nutritionSummary || costSummary || cookedSummary) && (
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              {componentSummary && (
                <p className="flex items-start gap-1 break-words">
                  <Layers className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {dict.includesLabel} {componentSummary} — {dict.componentsHint}
                  </span>
                </p>
              )}
              {nutritionSummary && <p>{nutritionSummary}</p>}
              {costSummary && (
                <p>
                  {costSummary} — {dict.recipeCostHint}
                </p>
              )}
              {cookedSummary && <p>{cookedSummary}</p>}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {/* GAP-42: only a recipe with steps has anything to cook from;
                cooking is what the sheet is mostly opened for, so it's the
                one primary action. */}
            {recipe.instructions?.trim() && (
              <Button type="button" className="justify-start" onClick={() => openFromSheet(dialogs.cook)}>
                <CookingPot className="size-4" />
                {dict.cookModeButton}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="justify-start"
              onClick={() => openFromSheet(dialogs.edit)}
            >
              <Pencil className="size-4" />
              {dict.editAriaLabel}
            </Button>
            {recipe.ingredients.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => openFromSheet(dialogs.review)}
              >
                <ListChecks className="size-4" />
                {dict.reviewMatchesAriaLabel}
              </Button>
            )}
            {/* GAP-43: stays in the sheet; the toast says it worked. */}
            <Button type="button" variant="outline" className="justify-start" onClick={handleCopyText}>
              <Copy className="size-4" />
              {dict.copyRecipeText}
            </Button>
          </div>
          {/* M2: delete sits apart from the other actions, under a rule. */}
          <div className="border-t pt-4">
            <Button
              type="button"
              variant="destructive"
              className="w-full justify-start"
              disabled={isPending}
              onClick={() => openFromSheet(dialogs.remove)}
            >
              <Trash2 className="size-4" />
              {dict.deleteAriaLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {recipe.instructions?.trim() && (
        <CookModeDialog dict={dict} locale={locale} recipe={recipe} handle={dialogs.cook} />
      )}
      <RecipeFormDialog
        dict={dict}
        mode="edit"
        recipe={recipe}
        allRecipes={allRecipes}
        ingredientNames={ingredientNames}
        ingredientUnits={ingredientUnits}
        handle={dialogs.edit}
      />
      {recipe.ingredients.length > 0 && (
        <RecipeFormDialog
          dict={dict}
          mode="edit"
          recipe={recipe}
          allRecipes={allRecipes}
          ingredientNames={ingredientNames}
          ingredientUnits={ingredientUnits}
          startAtReview
          handle={dialogs.review}
        />
      )}
      <ConfirmDialog
        handle={dialogs.remove}
        title={format(dict.confirmDelete.title, { name: recipe.name })}
        description={dict.confirmDelete.description}
        cancelLabel={dict.confirmDelete.cancel}
        confirmLabel={dict.confirmDelete.confirm}
        pendingLabel={dict.confirmDelete.confirming}
        onConfirm={handleDelete}
      />
    </div>
  );
}
