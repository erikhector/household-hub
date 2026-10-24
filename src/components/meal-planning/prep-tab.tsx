"use client";

import { useState } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { CalendarPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExpiryBadge } from "@/components/inventory/expiry-badge";
import { RecordPrepDialog } from "@/components/meal-planning/record-prep-dialog";
import { PlanPortionsDialog } from "@/components/meal-planning/plan-portions-dialog";
import { getWeekStart, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { discardBatchAction, undoDiscardBatchAction } from "@/app/dashboard/meal-planning/prep-actions";
import { format, plural } from "@/lib/i18n/format";
import type { PreparedBatchData, RecipeData } from "@/components/meal-planning/types";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PrimaryAction } from "@/components/dashboard/primary-action";
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";

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
}) {
  // The batch whose Plan portions dialog is open, by id: the batch itself is
  // read from `batches` on every render, so its count stays current after a
  // refresh, and the Record prep toast can open a batch it only knows the id
  // of (recordPrepAction's revalidation has put it in `batches` by the time
  // the toast shows). `openedAt` pins the dialog's first week for as long
  // as it stays open.
  const [planning, setPlanning] = useState<{ batchId: string; openedAt: number } | null>(null);
  const planningBatch = planning && batches.find((batch) => batch.id === planning.batchId);
  const openPlanning = (batchId: string) => setPlanning({ batchId, openedAt: Date.now() });

  // Batch dates are instants; formatted in UTC, as the planner formats its
  // days, so the server render and every browser name the same day.
  const dayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const formatDay = (iso: string) => dayFormat.format(new Date(iso));

  // UX-50, M2: Record prep is this tab's one primary, placed through
  // PrimaryAction like the Recipes tab's "New recipe": floating above the
  // bottom bar on a phone, in the header from `sm`. With no batches yet the
  // empty state holds it instead, so it is never on screen twice. (It used to
  // be a full-width bar of its own, sticky above the bottom bar.)
  const recordPrep = (
    <RecordPrepDialog dict={dict} recipes={recipes} maxDishes={maxDishes} onPlanPortions={openPlanning} />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold">{dict.prepTitle}</h2>
          <p className="text-sm text-muted-foreground">{dict.prepSubtitle}</p>
        </div>
        {batches.length > 0 && <PrimaryAction>{recordPrep}</PrimaryAction>}
      </div>

      {batches.length === 0 ? (
        <MascotEmptyState alt={dict.mascotAlt} action={recordPrep}>
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{dict.prepEmptyTitle}</p>
            <p className="text-sm text-muted-foreground">{dict.prepEmptyBody}</p>
          </div>
        </MascotEmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {batches.map((batch) => (
            <li key={batch.id}>
              <BatchCard
                dict={dict}
                inventoryDict={inventoryDict}
                batch={batch}
                formatDay={formatDay}
                onPlanPortions={(planned) => openPlanning(planned.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {planning && planningBatch && (
        <PlanPortionsDialog
          key={`${planning.batchId}-${planning.openedAt}`}
          dict={dict}
          locale={locale}
          batch={planningBatch}
          // The week of today, or of the cook date if that's later (a batch
          // can't be eaten before it's cooked).
          initialWeekStartKey={toDateKey(
            getWeekStart(new Date(Math.max(planning.openedAt, Date.parse(planningBatch.cookedAt)))),
          )}
          controlled={{
            open: true,
            onOpenChange: (next) => {
              if (!next) setPlanning(null);
            },
          }}
        />
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
          void undoDiscardBatchAction(snapshot).then(
            (undoResult) => {
              if (undoResult.error) toast.error(undoResult.error);
              else {
                toast.success(dict.prepDiscardUndoneToast);
                router.refresh();
              }
            },
            // Offline, a failed undo would otherwise fail silently.
            (error) => {
              unstable_rethrow(error);
              toast.error(dict.prepConnectionError);
            },
          );
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
        {/* Nothing left to hand out: a batch whose last portions are all
            planned stays on the tab, but there's nothing more to plan. */}
        <Button
          type="button"
          variant="secondary"
          disabled={batch.remainingPortions === 0}
          onClick={() => onPlanPortions(batch)}
        >
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
