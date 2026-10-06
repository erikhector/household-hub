"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addMissingIngredientsToShoppingListAction,
  previewMissingIngredientsAction,
} from "@/app/dashboard/meal-planning/cooking-actions";
import { NEW_SHOPPING_LIST_SENTINEL } from "@/app/dashboard/meal-planning/meal-types";
import { addDays, isDateKey, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import {
  MAX_MISSING_INGREDIENTS_RANGE_DAYS,
  parseMissingIngredientsRange,
  weekRange,
  type MissingIngredientsRange,
} from "@/app/dashboard/meal-planning/missing-ingredients";
import { format, plural } from "@/lib/i18n/format";
import { findSubstitutionKey, type SubstitutionKey } from "@/lib/inventory/substitutions";
import type { ActiveShoppingListOption, MissingIngredientData } from "@/components/meal-planning/types";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { useUnitLabel } from "@/components/units-provider";

type MealPlanningDict = Dictionary["mealPlanning"];

type ReviewItem = MissingIngredientData & {
  included: boolean;
  substitutionKey: SubstitutionKey | null;
};

const initialState: ActionState = {};

// GAP-32's range presets. "twoWeeks" is the visible week plus the one after
// it (anchored on the planner's week like "This week", not on today), and
// "custom" is any From/Through pair up to MAX_MISSING_INGREDIENTS_RANGE_DAYS.
const RANGE_PRESETS = ["week", "twoWeeks", "custom"] as const;
type RangePreset = (typeof RANGE_PRESETS)[number];

// The custom inputs start out showing the same two weeks as "twoWeeks" —
// the most likely thing to tweak from.
function defaultCustomThrough(weekStartKey: string): string {
  return toDateKey(addDays(parseDateKey(weekStartKey), 13));
}

// Resolves the picker's state to the half-open `[from, to)` range the
// preview action takes, or null for a custom range the server would reject
// (Through is inclusive in the UI — people think "the 1st through the
// 14th" — so it's shifted one day to become the exclusive `to`).
function rangeFor(
  preset: RangePreset,
  weekStartKey: string,
  customFrom: string,
  customThrough: string,
): MissingIngredientsRange | null {
  if (preset === "week") return weekRange(weekStartKey);
  if (preset === "twoWeeks") {
    return { from: weekStartKey, to: toDateKey(addDays(parseDateKey(weekStartKey), 14)) };
  }
  if (!isDateKey(customFrom) || !isDateKey(customThrough)) return null;
  const range = { from: customFrom, to: toDateKey(addDays(parseDateKey(customThrough), 1)) };
  return parseMissingIngredientsRange(range) ? range : null;
}

export function MissingIngredientsDialog({
  dict,
  weekStartKey,
  activeShoppingLists,
  onClose,
}: {
  dict: MealPlanningDict;
  weekStartKey: string;
  activeShoppingLists: ActiveShoppingListOption[];
  // UX-21: opened from the planner's ⋯ menu, which can't host a Dialog (it
  // unmounts with the menu), so the planner mounts this only while it is
  // open and it starts open. Closing (any way) calls onClose to unmount it.
  onClose: () => void;
}) {
  const unitLabel = useUnitLabel();
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Which dates to diff (GAP-32). Always "week" on open, so the default is
  // exactly the pre-GAP-32 behavior: the visible planner week.
  const [preset, setPreset] = useState<RangePreset>("week");
  const [customFrom, setCustomFrom] = useState(weekStartKey);
  const [customThrough, setCustomThrough] = useState(() => defaultCustomThrough(weekStartKey));
  // Switching range while a preview is still in flight must not let the
  // older (slower) response overwrite the newer one's items.
  const latestPreviewRef = useRef(0);
  const [targetListId, setTargetListId] = useState(
    activeShoppingLists[0]?.id ?? NEW_SHOPPING_LIST_SENTINEL,
  );

  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await addMissingIngredientsToShoppingListAction(prevState, formData);
    if (!result.error) {
      const listName =
        targetListId === NEW_SHOPPING_LIST_SENTINEL
          ? String(formData.get("newListName") || "").trim() || dict.newShoppingListOption
          : (activeShoppingLists.find((l) => l.id === targetListId)?.name ?? "");
      toast.success(format(dict.missingIngredientsAddedToast, { list: listName }));
      onClose();
    }
    return result;
  }, initialState);

  function changeRange(nextPreset: RangePreset, nextFrom: string, nextThrough: string) {
    setPreset(nextPreset);
    setCustomFrom(nextFrom);
    setCustomThrough(nextThrough);
    loadPreview(rangeFor(nextPreset, weekStartKey, nextFrom, nextThrough));
  }

  function loadPreview(range: MissingIngredientsRange | null) {
    const requestId = ++latestPreviewRef.current;
    setItems(null);
    setPreviewError(null);
    // An invalid custom range is shown inline (customRangeInvalid below)
    // rather than sent — the server would only reject it the same way.
    if (!range) return;
    startPreviewTransition(async () => {
      const result = await previewMissingIngredientsAction(range);
      if (requestId !== latestPreviewRef.current) return;
      if ("error" in result) {
        setPreviewError(result.error);
      } else {
        // Substitution hints (GAP-25) are looked up here rather than in the
        // preview action: the table is static and client-safe, and the hint
        // is purely advisory — it never changes what gets added to the list.
        setItems(
          result.items.map((item) => ({
            ...item,
            included: true,
            substitutionKey: findSubstitutionKey(item.name),
          })),
        );
      }
    });
  }

  // Always recomputed on open rather than cached across opens — the meal
  // plan or inventory may have changed since the dialog was last shown, and
  // this stays cheap (a handful of rows at household scale). Since the
  // dialog is mounted fresh each time, the range starts at "This week",
  // anchored on whichever week the planner is showing now.
  useEffect(() => {
    loadPreview(weekRange(weekStartKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  function toggleItem(key: string) {
    setItems((prev) =>
      prev ? prev.map((item) => (item.key === key ? { ...item, included: !item.included } : item)) : prev,
    );
  }

  const targetListLabel = (value: string) =>
    value === NEW_SHOPPING_LIST_SENTINEL
      ? dict.newShoppingListOption
      : (activeShoppingLists.find((l) => l.id === value)?.name ?? value);

  const rangePresetLabel = (value: RangePreset) =>
    value === "week"
      ? dict.missingIngredientsRangeThisWeek
      : value === "twoWeeks"
        ? dict.missingIngredientsRangeTwoWeeks
        : dict.missingIngredientsRangeCustom;

  const customRangeInvalid =
    preset === "custom" && rangeFor(preset, weekStartKey, customFrom, customThrough) === null;

  const includedCount = items?.filter((item) => item.included).length ?? 0;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.missingIngredientsDialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="missingIngredientsRange">{dict.missingIngredientsRangeLabel}</Label>
          <Select
            value={preset}
            onValueChange={(v) =>
              changeRange((v as RangePreset | null) ?? "week", customFrom, customThrough)
            }
          >
            <SelectTrigger id="missingIngredientsRange" className="w-full">
              <SelectValue>{rangePresetLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((value) => (
                <SelectItem key={value} value={value}>
                  {rangePresetLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {preset === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="missingIngredientsFrom" className="text-xs">
                  {dict.missingIngredientsRangeFrom}
                </Label>
                <Input
                  id="missingIngredientsFrom"
                  type="date"
                  value={customFrom}
                  onChange={(e) => changeRange("custom", e.target.value, customThrough)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="missingIngredientsThrough" className="text-xs">
                  {dict.missingIngredientsRangeThrough}
                </Label>
                <Input
                  id="missingIngredientsThrough"
                  type="date"
                  min={customFrom || undefined}
                  value={customThrough}
                  onChange={(e) => changeRange("custom", customFrom, e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {customRangeInvalid ? (
          <p className="text-sm text-destructive">
            {format(dict.missingIngredientsRangeInvalid, { max: MAX_MISSING_INGREDIENTS_RANGE_DAYS })}
          </p>
        ) : isPreviewPending || items === null ? (
          <p className="text-sm text-muted-foreground">
            {previewError ?? dict.loadingMissingIngredients}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {preset === "week" ? dict.noMissingIngredients : dict.noMissingIngredientsInRange}
          </p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {format(plural(items.length, dict.missingIngredientCount), { count: items.length })}
            </p>

            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {items.map((item) => (
                <div key={item.key} className="flex flex-col gap-0.5 rounded-md bg-muted px-2 py-1.5 text-sm">
                  <label className="flex items-center gap-2 max-sm:min-h-11">
                    <Checkbox
                      checked={item.included}
                      onChange={() => toggleItem(item.key)}
                    />
                    <span className="min-w-0 flex-1 truncate" title={item.name}>
                      {item.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {item.missingQuantity} {unitLabel(item.unit)}
                    </span>
                    {item.included && (
                      <>
                        <input type="hidden" name="itemName" value={item.name} />
                        <input type="hidden" name="itemQuantity" value={item.missingQuantity} />
                        <input type="hidden" name="itemUnit" value={item.unit} />
                      </>
                    )}
                  </label>
                  {item.unitMismatch && (
                    <p className="pl-6 text-xs text-warning">{dict.missingIngredientUnitMismatchNote}</p>
                  )}
                  {item.substitutionKey && (
                    <p className="pl-6 text-xs text-muted-foreground">
                      {format(dict.missingIngredientSubstitutionHint, {
                        substitute: dict.substitutions[item.substitutionKey],
                      })}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="targetListId">{dict.targetListLabel}</Label>
              <Select
                value={targetListId}
                onValueChange={(v) => setTargetListId(v ?? NEW_SHOPPING_LIST_SENTINEL)}
              >
                <SelectTrigger id="targetListId" className="w-full">
                  <SelectValue>{targetListLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeShoppingLists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_SHOPPING_LIST_SENTINEL}>
                    {dict.newShoppingListOption}
                  </SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="targetListId" value={targetListId} />
            </div>

            {targetListId === NEW_SHOPPING_LIST_SENTINEL && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="newListName">{dict.newListNameLabel}</Label>
                <Input enterKeyHint="done" id="newListName" name="newListName" placeholder={dict.newListNamePlaceholder} />
              </div>
            )}

            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending || includedCount === 0}>
                {pending ? dict.adding : dict.addMissingIngredientsSubmit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
