"use client";

// Step 2 of RecipeFormDialog, "Match ingredients" (MATCH-1, design
// docs/archive/RECIPE_INGREDIENT_MATCHING.md §3.1). Built from the receipt review's
// pieces (AUTO-11): rows the matcher is confident about are collapsed into
// an AutoMatchedSection, and only the rest are open, each with the same
// "Use existing / Create new" choice as ResolveMappingsDialog, plus "Don't
// track" (MATCH-2) for ingredients like water that the pantry never holds.
// A row whose unit the item can't convert also gets the three unit choices
// (MATCH-3, §3.3): remember a conversion for the item, override the amount
// for this recipe, or decide when cooking. Nothing here writes anything:
// the choices live in the dialog's state and are sent as explicit per-row
// decisions when the recipe is saved.

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Radio } from "@/components/ui/radio";
import { ComboField } from "@/components/inventory/combo-field";
import { ItemCombobox } from "@/components/inventory/item-combobox";
import { AutoMatchedSection } from "@/components/shopping/auto-matched-section";
import { format, plural } from "@/lib/i18n/format";
import type { IngredientMatchStatus } from "@/lib/recipes/ingredient-match";
import { rowUnitChoice, type RowUnitChoice, type UnitChoiceAction } from "@/lib/recipes/unit-choice";
import type { IngredientPreviewItem } from "@/app/dashboard/meal-planning/recipe-actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { useUnitLabel } from "@/components/units-provider";

type MealPlanningDict = Dictionary["mealPlanning"];

export type ReviewRow = {
  /** The RecipeFormDialog ingredient row this decision belongs to. */
  uid: string;
  /** What the recipe says, e.g. "300 g vetemjöl". */
  label: string;
  name: string;
  /** The recipe's amount, for the "this recipe only" default. */
  quantity: number;
  unit: string;
  status: IngredientMatchStatus;
  needsReview: boolean;
  /** Whether the matcher defaulted this row to "Don't track" (MATCH-2). */
  defaultUntracked: boolean;
  mode: "existing" | "new" | "untracked";
  selectedId: string;
  /** Best-first item ids to list above the rest in the picker. */
  candidateIds: string[];
  newName: string;
  newCategory: string;
  newUnit: string;
  /** False while `newUnit` is still the default we picked, so the row
   * doesn't warn about a unit the user never chose. */
  newUnitTouched: boolean;
  /** The unit choice (MATCH-3) for a row whose unit the item can't
   * convert; null until the user picks one (see rowUnitChoice). */
  unitAction: UnitChoiceAction | null;
  /** "1 X = [n] Y" as typed, in conversionLeadUnit's order; null shows the
   * density hint, if there is one. */
  rememberValue: string | null;
  /** "[n] pcs in this recipe only" as typed; null shows the hint's amount. */
  overrideValue: string | null;
};

// A choice that no longer fits once the item or its unit changes.
export const UNIT_CHOICE_RESET = { unitAction: null, rememberValue: null, overrideValue: null } as const;

export type ReviewState = {
  rows: ReviewRow[];
  items: IngredientPreviewItem[];
  categories: string[];
};

/** Why a row can't be saved as it stands, or null when it can. */
export function reviewRowError(
  row: ReviewRow,
  items: IngredientPreviewItem[],
  dict: MealPlanningDict["ingredientReview"],
): string | null {
  if (row.mode === "existing" && !row.selectedId) return dict.existingSelectionRequired;
  if (row.mode === "new" && !row.newName.trim()) return dict.newNameRequired;
  const choice = rowUnitChoice(row, items);
  if (choice.action === "remember" && choice.factor === null) return dict.unitFactorError;
  if (choice.action === "override" && choice.overrideQuantity === null) return dict.overrideQuantityError;
  return null;
}

export function IngredientReviewStep({
  review,
  dict,
  attempted,
  onRowChange,
  expandMatched = false,
}: {
  review: ReviewState;
  dict: MealPlanningDict;
  /** Save was pressed once, so incomplete rows show why. */
  attempted: boolean;
  onRowChange: (uid: string, patch: Partial<ReviewRow>) => void;
  /** Start with the matched rows shown: "Review ingredient matches"
   * (MATCH-5) opens this step to look at every link, not just the open
   * ones. */
  expandMatched?: boolean;
}) {
  const t = dict.ingredientReview;
  const [showMatched, setShowMatched] = useState(expandMatched);
  const matched = review.rows.filter((row) => !row.needsReview);
  const needsLook = review.rows.filter((row) => row.needsReview);
  // The batch helpers only flip rows the matcher had no confident answer
  // for; a confident row that's only here for its unit keeps its match.
  // "Create all new" leaves Don't-track rows alone: water stays water.
  const open = needsLook.filter((row) => row.status !== "confident");
  const leftOver = open.filter((row) => row.mode === "existing");
  const trackedRest = open.filter((row) => row.mode !== "untracked");
  const errorCount = attempted ? review.rows.filter((row) => reviewRowError(row, review.items, t)).length : 0;

  const renderRow = (row: ReviewRow) => (
    <ReviewRowCard
      key={row.uid}
      row={row}
      review={review}
      dict={dict}
      error={attempted ? reviewRowError(row, review.items, t) : null}
      onChange={(patch) => onRowChange(row.uid, patch)}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      {errorCount > 0 && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {format(plural(errorCount, t.errorSummary), { count: errorCount })}
        </p>
      )}
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
            <div className="flex flex-wrap gap-1">
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
              {trackedRest.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => trackedRest.forEach((row) => onRowChange(row.uid, { mode: "untracked" }))}
                >
                  {t.dontTrackRest}
                </Button>
              )}
            </div>
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
  const unitLabel = useUnitLabel();
  const t = dict.ingredientReview;
  const candidates = row.candidateIds
    .map((id) => review.items.find((item) => item.id === id))
    .filter((item): item is IngredientPreviewItem => !!item);
  const candidateIds = new Set(row.candidateIds);
  const orderedItems = [...candidates, ...review.items.filter((item) => !candidateIds.has(item.id))];

  const choice = rowUnitChoice(row, review.items);
  const { pantryUnit, unitClass } = choice;
  // The default unit for a new item is our pick, not a mismatch the user
  // made, so it gets a neutral note instead of a warning.
  const isDefaultNewUnit = row.mode === "new" && !row.newUnitTouched;
  const fieldId = `ingredient-review-${row.uid}`;
  const errorId = `${fieldId}-error`;
  // Why the row is open at all: a confident row with a unit problem says so
  // through its unit note below.
  const reason = !row.needsReview
    ? null
    : row.defaultUntracked
      ? t.reasonStaple
      : row.status === "suggested" && candidates[0]
        ? format(t.reasonSuggested, { name: candidates[0].name })
        : row.status === "none"
          ? t.reasonNone
          : null;

  return (
    <div role="group" aria-label={row.label} className="flex min-w-0 flex-col gap-2 rounded-md border bg-background p-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium break-words">{row.label}</p>
          {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
        </div>
        <div className="flex w-fit shrink-0 flex-wrap gap-1 rounded-lg bg-muted p-1">
          {review.items.length > 0 && (
            <Button
              type="button"
              variant={row.mode === "existing" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={row.mode === "existing"}
              onClick={() => onChange({ mode: "existing", ...UNIT_CHOICE_RESET })}
            >
              {t.useExisting}
            </Button>
          )}
          <Button
            type="button"
            variant={row.mode === "new" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={row.mode === "new"}
            onClick={() => onChange({ mode: "new", ...UNIT_CHOICE_RESET })}
          >
            {t.createNew}
          </Button>
          <Button
            type="button"
            variant={row.mode === "untracked" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={row.mode === "untracked"}
            onClick={() => onChange({ mode: "untracked" })}
          >
            {t.dontTrack}
          </Button>
        </div>
      </div>

      {row.mode === "untracked" && <p className="text-xs text-muted-foreground">{t.dontTrackHint}</p>}

      {row.mode === "existing" && (
        <ItemCombobox
          items={orderedItems.map((item) => ({ id: item.id, label: `${item.name} · ${item.category}` }))}
          value={row.selectedId}
          onValueChange={(value) => onChange({ selectedId: value, ...UNIT_CHOICE_RESET })}
          id={`${fieldId}-item`}
          ariaLabel={format(t.existingItemLabel, { name: row.name })}
          emptyMessage={t.existingItemNoResults}
          invalid={!!error}
          describedBy={error ? errorId : undefined}
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
              aria-invalid={!!error || undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          <div className="flex min-w-0 gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Label htmlFor={`${fieldId}-category`} className="text-xs font-normal text-muted-foreground">
                {t.newCategoryLabel}
              </Label>
              <ComboField
                id={`${fieldId}-category`}
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
                onChange={(e) => onChange({ newUnit: e.target.value, newUnitTouched: true, ...UNIT_CHOICE_RESET })}
                maxLength={20}
              />
            </div>
          </div>
        </div>
      )}

      {pantryUnit && isDefaultNewUnit && (
        <p className="text-xs text-muted-foreground">{format(t.newUnitDefault, { unit: unitLabel(pantryUnit) })}</p>
      )}
      {pantryUnit && !isDefaultNewUnit && (unitClass === "same" || unitClass === "convertible") && (
        <p className="text-xs text-muted-foreground">{format(t.unitOk, { unit: unitLabel(pantryUnit) })}</p>
      )}
      {pantryUnit && !isDefaultNewUnit && unitClass === "known" && (
        <p className="text-xs text-muted-foreground">{format(t.unitKnown, { unit: unitLabel(pantryUnit) })}</p>
      )}
      {pantryUnit && !isDefaultNewUnit && unitClass === "unknown" && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
          {format(t.unitUnknown, { recipeUnit: unitLabel(row.unit), itemUnit: unitLabel(pantryUnit) })}
        </p>
      )}
      {pantryUnit && unitClass === "unknown" && (
        <UnitChoiceFields row={row} choice={choice} pantryUnit={pantryUnit} dict={dict} onChange={onChange} />
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// The three choices for a row whose unit the item can't convert (MATCH-3,
// design §3.3). Native radios in a fieldset, so they're one tab stop with
// arrow-key selection and read as a group; only the chosen option shows its
// amount field, which keeps the row short on a phone.
function UnitChoiceFields({
  row,
  choice,
  pantryUnit,
  dict,
  onChange,
}: {
  row: ReviewRow;
  choice: RowUnitChoice;
  pantryUnit: string;
  dict: MealPlanningDict;
  onChange: (patch: Partial<ReviewRow>) => void;
}) {
  const unitLabel = useUnitLabel();
  const t = dict.ingredientReview;
  const group = `ingredient-review-${row.uid}-unit`;
  const option = (value: UnitChoiceAction, label: string) => (
    <label className="flex items-center gap-2 text-sm max-sm:min-h-11 pointer-coarse:min-h-11">
      <Radio
        name={group}
        value={value}
        checked={choice.action === value}
        onChange={() => onChange({ unitAction: value })}
      />
      {label}
    </label>
  );

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="sr-only">{format(t.unitChoiceLabel, { name: row.name })}</legend>
      {option("remember", t.unitRemember)}
      {choice.action === "remember" && (
        <div className="flex flex-col gap-1 pl-6">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span>1 {unitLabel(choice.leadUnit)} =</span>
            <Input
              value={choice.rememberValue}
              onChange={(e) => onChange({ rememberValue: e.target.value })}
              inputMode="decimal"
              className="h-8 w-24"
              aria-label={format(t.unitRememberInputLabel, { unit: unitLabel(choice.otherUnit), leadUnit: unitLabel(choice.leadUnit) })}
            />
            <span>{unitLabel(choice.otherUnit)}</span>
          </div>
          {choice.fromHint && <p className="text-xs text-muted-foreground">{t.unitRememberHint}</p>}
        </div>
      )}
      {option("override", t.unitOverride)}
      {choice.action === "override" && (
        <div className="flex flex-wrap items-center gap-1.5 pl-6 text-sm">
          <Input
            value={choice.overrideValue}
            onChange={(e) => onChange({ overrideValue: e.target.value })}
            inputMode="decimal"
            className="h-8 w-24"
            aria-label={format(t.unitOverrideInputLabel, { unit: unitLabel(pantryUnit) })}
          />
          <span>{unitLabel(pantryUnit)}</span>
        </div>
      )}
      {option("defer", t.unitDefer)}
      {choice.action === "defer" && <p className="pl-6 text-xs text-muted-foreground">{t.unitDeferHint}</p>}
    </fieldset>
  );
}
