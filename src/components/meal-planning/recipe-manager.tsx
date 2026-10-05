"use client";

import { Fragment, useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChefHat, CookingPot, Layers, ListChecks, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RECIPE_TAGS, isRecipeTag, recipeMatchesTag } from "@/lib/recipe-tags";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">{dict.recipesTitle}</h2>
          <p className="text-sm text-muted-foreground">{dict.recipesSubtitle}</p>
        </div>
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
      </div>

      {useItUpSuggestions.length > 0 && <UseItUpSuggestions suggestions={useItUpSuggestions} dict={dict} />}

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
  numberFormat,
  allRecipes,
  ingredientNames,
  ingredientUnits,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  recipe: RecipeData;
  cost: RecipeCost | null;
  numberFormat: Intl.NumberFormat;
  allRecipes: RecipeData[];
  ingredientNames: string[];
  ingredientUnits: Record<string, string>;
}) {
  const [isPending, startTransition] = useTransition();
  // An imported row's prep note (MATCH-2) reads after its name, the way
  // the recipe had it: "gul lök (finhackad)".
  const ingredientSummary = recipe.ingredients
    .map((ingredient) => (ingredient.note ? `${ingredient.name} (${ingredient.note})` : ingredient.name))
    .join(", ");
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

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <ChefHat className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={recipe.name}>
          {recipe.name}
        </p>
        {/* GAP-29: only the tags actually set — recipe.tags is already in
            canonical order (see page.tsx). */}
        {recipe.tags.length > 0 && (
          <div className="mt-0.5 mb-1 flex flex-wrap gap-1">
            {recipe.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {dict.recipeTags[tag]}
              </Badge>
            ))}
          </div>
        )}
        {ingredientSummary && (
          <p className="truncate text-sm text-muted-foreground" title={ingredientSummary}>
            {/* MATCH-6: a linked ingredient opens its pantry item's page,
                whose back arrow comes back to this tab. */}
            {recipe.ingredients.map((ingredient, index) => (
              <Fragment key={ingredient.id}>
                {index > 0 && ", "}
                {ingredient.inventoryItemId ? (
                  <Link
                    href={itemPageHref(ingredient.inventoryItemId, { kind: "recipes" })}
                    className="underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {ingredient.name}
                  </Link>
                ) : (
                  ingredient.name
                )}
                {ingredient.note && ` (${ingredient.note})`}
              </Fragment>
            ))}
          </p>
        )}
        {componentSummary && (
          <p
            className="flex items-center gap-1 truncate text-sm text-muted-foreground"
            title={`${dict.includesLabel} ${componentSummary} — ${dict.componentsHint}`}
          >
            <Layers className="size-3 shrink-0" />
            <span className="truncate">
              {dict.includesLabel} {componentSummary}
            </span>
          </p>
        )}
        {nutritionSummary && (
          <p className="truncate text-sm text-muted-foreground" title={nutritionSummary}>
            {nutritionSummary}
          </p>
        )}
        {costSummary && (
          <p className="truncate text-sm text-muted-foreground" title={`${costSummary} — ${dict.recipeCostHint}`}>
            {costSummary}
          </p>
        )}
        {/* GAP-42: only a recipe with steps has anything to cook from. Under
            the details, not among the icon buttons, so the row's name keeps
            its width on a phone. */}
        {recipe.instructions?.trim() && (
          <CookModeDialog
            dict={dict}
            locale={locale}
            recipe={recipe}
            trigger={
              <Button type="button" variant="outline" size="sm" className="mt-2">
                <CookingPot className="size-3.5" />
                {dict.cookModeButton}
              </Button>
            }
          />
        )}
      </div>
      <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">
        {format(plural(recipe.servings, dict.servingsCount), { count: recipe.servings })}
        {" · "}
        {format(plural(recipe.ingredients.length, dict.ingredientCount), {
          count: recipe.ingredients.length,
        })}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
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
        <RecipeFormDialog
          dict={dict}
          mode="edit"
          recipe={recipe}
          allRecipes={allRecipes}
          ingredientNames={ingredientNames}
          ingredientUnits={ingredientUnits}
          trigger={
            <Button type="button" variant="ghost" size="icon-sm" aria-label={dict.editAriaLabel}>
              <Pencil className="size-3.5" />
            </Button>
          }
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
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={dict.reviewMatchesAriaLabel}
                title={dict.reviewMatchesAriaLabel}
              >
                <ListChecks className="size-3.5" />
              </Button>
            }
          />
        )}
        <ConfirmDialog
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={isPending}
              aria-label={dict.deleteAriaLabel}
            >
              <Trash2 className="size-3.5" />
            </Button>
          }
          title={format(dict.confirmDelete.title, { name: recipe.name })}
          description={dict.confirmDelete.description}
          cancelLabel={dict.confirmDelete.cancel}
          confirmLabel={dict.confirmDelete.confirm}
          pendingLabel={dict.confirmDelete.confirming}
          onConfirm={handleDelete}
        />
      </span>
    </div>
  );
}
