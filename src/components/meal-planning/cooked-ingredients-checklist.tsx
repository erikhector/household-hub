"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { CookedIngredientData } from "@/components/meal-planning/types";
import { useUnitLabel } from "@/components/units-provider";

type MealPlanningDict = Dictionary["mealPlanning"];

export type ReviewItem = CookedIngredientData & { included: boolean; quantity: string };

export function toReviewItems(items: CookedIngredientData[]): ReviewItem[] {
  return items.map((item) => ({ ...item, included: true, quantity: String(item.suggestedQuantity) }));
}

// The editable list of inventory items a cook will use up. Included rows emit
// the hidden itemId/itemQuantity pairs that parseCookedRows reads server-side,
// so it must sit inside the <form> of whichever dialog owns it.
export function CookedIngredientsChecklist({
  dict,
  items,
  onToggle,
  onQuantityChange,
}: {
  dict: MealPlanningDict;
  items: ReviewItem[];
  onToggle: (key: string) => void;
  onQuantityChange: (key: string, quantity: string) => void;
}) {
  const unitLabel = useUnitLabel();
  return (
    <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
      {items.map((item) => (
        <div key={item.key} className="flex flex-col gap-1 rounded-md bg-muted px-2 py-1.5 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={item.included}
              onChange={() => onToggle(item.key)}
            />
            <span className="min-w-0 flex-1 line-clamp-2 break-words sm:line-clamp-1" title={item.name}>
              {item.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {format(dict.onHandQuantityLabel, { quantity: item.onHandQuantity, unit: unitLabel(item.unit) })}
            </span>
          </label>
          <div className="flex items-center gap-2 pl-6">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              className="w-24"
              value={item.quantity}
              disabled={!item.included}
              onChange={(e) => onQuantityChange(item.key, e.target.value)}
              aria-label={format(dict.cookedQuantityAriaLabel, { name: item.name })}
            />
            <span className="text-xs text-muted-foreground">{unitLabel(item.unit)}</span>
            {item.unitMismatch && (
              <span className="text-xs text-warning">
                {format(dict.cookedIngredientUnitMismatchNote, {
                  quantity: item.requiredQuantity,
                  unit: item.requiredUnit,
                })}
              </span>
            )}
          </div>
          {item.included && (
            <>
              <input type="hidden" name="itemId" value={item.inventoryItemId} />
              <input type="hidden" name="itemQuantity" value={item.quantity} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
