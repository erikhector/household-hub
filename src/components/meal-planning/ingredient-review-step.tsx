"use client";

// Step 2 of RecipeFormDialog, "Match ingredients" (MATCH-1, design
// docs/RECIPE_INGREDIENT_MATCHING.md §3.1). Built from the receipt review's
// pieces (AUTO-11): rows the matcher is confident about are collapsed into
// an AutoMatchedSection, and only the rest are open, each with the same
// "Use existing / Create new" choice as ResolveMappingsDialog. Nothing here
// writes anything: the choices live in the dialog's state and are sent as
// explicit per-row decisions when the recipe is saved.

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboField } from "@/components/inventory/combo-field";
import { ItemCombobox } from "@/components/inventory/item-combobox";
import { AutoMatchedSection } from "@/components/shopping/auto-matched-section";
import { format, plural } from "@/lib/i18n/format";
import { classifyUnits } from "@/lib/units";
import type { IngredientMatchStatus } from "@/lib/recipes/ingredient-match";
import type { IngredientPreviewItem } from "@/app/dashboard/meal-planning/recipe-actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

export type ReviewRow = {
  /** The RecipeFormDialog ingredient row this decision belongs to. */
  uid: string;
  /** What the recipe says, e.g. "300 g vetemjöl". */
  label: string;
  name: string;
  unit: string;
  status: IngredientMatchStatus;
  needsReview: boolean;
  mode: "existing" | "new";
  selectedId: string;
  /** Best-first item ids to list above the rest in the picker. */
  candidateIds: string[];
  newName: string;
  newCategory: string;
  newUnit: string;
};

export type ReviewState = {
  rows: ReviewRow[];
  items: IngredientPreviewItem[];
  categories: string[];
};

/** Why a row can't be saved as it stands, or null when it can. */
export function reviewRowError(row: ReviewRow, dict: MealPlanningDict["ingredientReview"]): string | null {
  if (row.mode === "existing" && !row.selectedId) return dict.existingSelectionRequired;
  if (row.mode === "new" && !row.newName.trim()) return dict.newNameRequired;
  return null;
}

export function IngredientReviewStep({
  review,
  dict,
  attempted,
  onRowChange,
}: {
  review: ReviewState;
  dict: MealPlanningDict;
  /** Save was pressed once, so incomplete rows show why. */
  attempted: boolean;
  onRowChange: (uid: string, patch: Partial<ReviewRow>) => void;
}) {
  const t = dict.ingredientReview;
  const [showMatched, setShowMatched] = useState(false);
  const matched = review.rows.filter((row) => !row.needsReview);
  const needsLook = review.rows.filter((row) => row.needsReview);
  // "Create all new" only flips rows the matcher had no confident item for;
  // a confident row that's only here for its unit keeps its match.
  const leftOver = needsLook.filter((row) => row.status !== "confident" && row.mode !== "new");

  const renderRow = (row: ReviewRow) => (
    <ReviewRowCard
      key={row.uid}
      row={row}
      review={review}
      dict={dict}
      error={attempted ? reviewRowError(row, t) : null}
      onChange={(patch) => onRowChange(row.uid, patch)}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      {matched.length > 0 && (
        <AutoMatchedSection
          summary={format(plural(matched.length, t.matchedSummary), { count: matched.length })}
          expanded={showMatched}
          onExpandedChange={setShowMatched}
          showLabel={t.show}
          hideLabel={t.hide}
        >
          {matched.map(renderRow)}
        </AutoMatchedSection>
      )}
      {needsLook.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{format(t.needsLook, { count: needsLook.length })}</h3>
            {leftOver.length > 1 && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => leftOver.forEach((row) => onRowChange(row.uid, { mode: "new" }))}
              >
                {t.createAllNew}
              </Button>
            )}
          </div>
          {needsLook.map(renderRow)}
        </div>
      )}
    </div>
  );
}

function ReviewRowCard({
  row,
  review,
  dict,
  error,
  onChange,
}: {
  row: ReviewRow;
  review: ReviewState;
  dict: MealPlanningDict;
  error: string | null;
  onChange: (patch: Partial<ReviewRow>) => void;
}) {
  const t = dict.ingredientReview;
  const candidates = row.candidateIds
    .map((id) => review.items.find((item) => item.id === id))
    .filter((item): item is IngredientPreviewItem => !!item);
  const candidateIds = new Set(row.candidateIds);
  const orderedItems = [...candidates, ...review.items.filter((item) => !candidateIds.has(item.id))];

  // What the pantry counts this in: the chosen item's unit, or the unit the
  // new item will get. A unit that can't be reconciled isn't an error —
  // cooking asks for the amount, as it does today.
  const pantryUnit =
    row.mode === "existing"
      ? review.items.find((item) => item.id === row.selectedId)?.unit
      : row.newUnit.trim() || undefined;
  const unitClass = pantryUnit ? classifyUnits(row.unit, pantryUnit) : null;
  const fieldId = `ingredient-review-${row.uid}`;

  return (
    <div role="group" aria-label={row.label} className="flex flex-col gap-2 rounded-md border bg-background p-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={row.label}>
          {row.label}
        </p>
        <div className="flex w-fit shrink-0 gap-1 rounded-lg bg-muted p-1">
          {review.items.length > 0 && (
            <Button
              type="button"
              variant={row.mode === "existing" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={row.mode === "existing"}
              onClick={() => onChange({ mode: "existing" })}
            >
              {t.useExisting}
            </Button>
          )}
          <Button
            type="button"
            variant={row.mode === "new" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={row.mode === "new"}
            onClick={() => onChange({ mode: "new" })}
          >
            {t.createNew}
          </Button>
        </div>
      </div>

      {row.mode === "existing" && (
        <ItemCombobox
          items={orderedItems.map((item) => ({ id: item.id, label: `${item.name} · ${item.category}` }))}
          value={row.selectedId}
          onValueChange={(value) => onChange({ selectedId: value })}
          ariaLabel={format(t.existingItemLabel, { name: row.name })}
          emptyMessage={t.existingItemNoResults}
        />
      )}

      {row.mode === "new" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-name`} className="text-xs font-normal text-muted-foreground">
              {t.newNameLabel}
            </Label>
            <Input
              id={`${fieldId}-name`}
              value={row.newName}
              onChange={(e) => onChange({ newName: e.target.value })}
              maxLength={120}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Label htmlFor={`${fieldId}-category`} className="text-xs font-normal text-muted-foreground">
                {t.newCategoryLabel}
              </Label>
              <ComboField
                id={`${fieldId}-category`}
                name="reviewNewCategory"
                items={review.categories}
                value={row.newCategory}
                onValueChange={(value) => onChange({ newCategory: value })}
                placeholder={t.newCategoryPlaceholder}
                maxLength={60}
                dict={dict}
              />
            </div>
            <div className="flex w-24 shrink-0 flex-col gap-1">
              <Label htmlFor={`${fieldId}-unit`} className="text-xs font-normal text-muted-foreground">
                {t.newUnitLabel}
              </Label>
              <Input
                id={`${fieldId}-unit`}
                value={row.newUnit}
                onChange={(e) => onChange({ newUnit: e.target.value })}
                maxLength={20}
              />
            </div>
          </div>
        </div>
      )}

      {pantryUnit && unitClass !== "unknown" && (
        <p className="text-xs text-muted-foreground">{format(t.unitOk, { unit: pantryUnit })}</p>
      )}
      {pantryUnit && unitClass === "unknown" && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
          {format(t.unitUnknown, { recipeUnit: row.unit, itemUnit: pantryUnit })}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
