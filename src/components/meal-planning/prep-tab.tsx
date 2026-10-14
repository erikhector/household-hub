"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CookingPot, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExpiryBadge } from "@/components/inventory/expiry-badge";
import { RecordPrepDialog } from "@/components/meal-planning/record-prep-dialog";
import { discardBatchAction, undoDiscardBatchAction } from "@/app/dashboard/meal-planning/prep-actions";
import { format, plural } from "@/lib/i18n/format";
import type { PreparedBatchData, RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

// GAP-49: the Prep tab — "Record prep" on top, then one card per active
// batch, soonest eat-by first (getActiveBatches already sorts them).
export function PrepTab({
  dict,
  inventoryDict,
  locale,
  batches,
  recipes,
  maxDishes,
}: {
  dict: MealPlanningDict;
  // ExpiryBadge is the inventory page's component and reads its own words.
  inventoryDict: Dictionary["inventory"];
  locale: string;
  batches: PreparedBatchData[];
  recipes: RecipeData[];
  maxDishes: number;
  // The week the Planner tab shows; the Plan portions dialog opens on it.
  plannerWeekStartKey: string;
}) {
  // The batch whose Plan portions dialog is open. The dialog itself is the
  // next step of GAP-49, so for now the button only records the choice.
  const [, setPlanningBatch] = useState<PreparedBatchData | null>(null);

  // Batch dates are instants; formatted in UTC, as the planner formats its
  // days, so the server render and every browser name the same day.
  const dayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const formatDay = (iso: string) => dayFormat.format(new Date(iso));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{dict.prepTitle}</h2>
        <p className="text-sm text-muted-foreground">{dict.prepSubtitle}</p>
      </div>

      <RecordPrepDialog dict={dict} recipes={recipes} maxDishes={maxDishes} />

      {batches.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
          <CookingPot className="size-6 text-muted-foreground" aria-hidden />
          <p className="font-semibold">{dict.prepEmptyTitle}</p>
          <p className="text-sm text-muted-foreground">{dict.prepEmptyBody}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {batches.map((batch) => (
            <li key={batch.id}>
              <BatchCard
                dict={dict}
                inventoryDict={inventoryDict}
                batch={batch}
                formatDay={formatDay}
                onPlanPortions={setPlanningBatch}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BatchCard({
  dict,
  inventoryDict,
  batch,
  formatDay,
  onPlanPortions,
}: {
  dict: MealPlanningDict;
  inventoryDict: Dictionary["inventory"];
  batch: PreparedBatchData;
  formatDay: (iso: string) => string;
  onPlanPortions: (batch: PreparedBatchData) => void;
}) {
  const router = useRouter();
  const cookedDay = formatDay(batch.cookedAt);

  async function discard() {
    const result = await discardBatchAction(batch.id);
    if (result.error || !result.snapshot) return result;
    const { snapshot } = result;
    toast.success(format(dict.prepDiscardedToast, { recipe: batch.recipeName }), {
      duration: 8000,
      action: {
        label: dict.prepUndo,
        onClick: () => {
          void undoDiscardBatchAction(snapshot).then((undoResult) => {
            if (undoResult.error) toast.error(undoResult.error);
            else {
              toast.success(dict.prepDiscardUndoneToast);
              router.refresh();
            }
          });
        },
      },
    });
    return result;
  }

  return (
    <Card size="sm" className="px-3">
      <div className="flex flex-col gap-1">
        <h3 className="line-clamp-2 break-words text-base font-semibold" title={batch.recipeName}>
          {batch.recipeName}
        </h3>
        <p className="font-medium tabular-nums">
          {format(plural(batch.totalPortions, dict.prepPortionsLeft), {
            remaining: batch.remainingPortions,
            total: batch.totalPortions,
          })}
        </p>
        {batch.expiryDate && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            <span>{format(dict.prepEatBy, { day: formatDay(batch.expiryDate) })}</span>
            <ExpiryBadge expiresAt={new Date(batch.expiryDate)} dict={inventoryDict} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {batch.cookedByName
            ? format(dict.prepCookedBy, { name: batch.cookedByName, day: cookedDay })
            : format(dict.prepCookedOn, { day: cookedDay })}
        </p>
      </div>

      {/* M2: Discard sits at the far end, away from Plan portions. */}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="secondary" onClick={() => onPlanPortions(batch)}>
          <CalendarPlus />
          {dict.prepPlanPortions}
        </Button>
        <ConfirmDialog
          trigger={
            <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive">
              <Trash2 />
              {dict.prepDiscard}
            </Button>
          }
          title={format(dict.prepConfirmDiscard.title, { recipe: batch.recipeName })}
          description={dict.prepConfirmDiscard.description}
          cancelLabel={dict.prepConfirmDiscard.cancel}
          confirmLabel={dict.prepConfirmDiscard.confirm}
          pendingLabel={dict.prepConfirmDiscard.confirming}
          onConfirm={discard}
        />
      </div>
    </Card>
  );
}
