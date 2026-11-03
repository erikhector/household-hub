"use client";

// GAP-69 "Check stock": the manual counterpart of the AI shelf scan's restock
// mode. Pick a location (or all), then walk its items one per step: the
// amount is pre-filled with what the list says, so "Correct, next" keeps it
// and typing a different number takes that. A changed amount is saved at once
// as a counted value through bulkSetInventoryQuantitiesAction (so household
// scoping and the out-of-stock / low-stock side effects are the same as a
// scan's), which means closing half way (Escape, the back gesture, the X)
// keeps everything already checked and needs no "discard?" question. No
// camera, no AI, no schema, no history.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogHandle,
} from "@/components/ui/dialog";
import { bulkSetInventoryQuantitiesAction } from "@/app/dashboard/inventory/actions";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import { useUnitLabel } from "@/components/units-provider";
import { formatQuantity } from "@/lib/format-quantity";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { buildStockCheckQueue, confirmStockCheckStep, inputModeForUnit, type StockCheckItem } from "@/lib/stock-check";

type Phase = "pick" | "walk" | "summary";
type Counts = { checked: number; corrected: number; skipped: number };
const NO_COUNTS: Counts = { checked: 0, corrected: 0, skipped: 0 };

export function StockCheckDialog({
  dict,
  items,
  locations,
  handle,
}: {
  dict: Dictionary["inventory"];
  items: StockCheckItem[];
  locations: string[];
  // Opened through this handle by a trigger that stays in the page's own chunk
  // (PERF-26, ui/lazy-dialog.tsx).
  handle: DialogHandle;
}) {
  const t = dict.stockCheck;
  const unitLabel = useUnitLabel();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("pick");
  const [queue, setQueue] = useState<StockCheckItem[]>([]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [counts, setCounts] = useState<Counts>(NO_COUNTS);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setPhase("pick");
      setQueue([]);
      setIndex(0);
      setCounts(NO_COUNTS);
      setError(null);
    }
  }

  function begin(location: string | null) {
    // Copy of the items as the page has them now; amounts saved during the
    // walk don't need to be re-read, each item is visited once.
    const next = buildStockCheckQueue([...items], location);
    if (next.length === 0) return;
    setQueue(next);
    setIndex(0);
    setTyped(String(next[0].quantity));
    setCounts(NO_COUNTS);
    setError(null);
    setPhase("walk");
  }

  function advance(update: Partial<Counts>) {
    const merged = {
      checked: counts.checked + (update.checked ?? 0),
      corrected: counts.corrected + (update.corrected ?? 0),
      skipped: counts.skipped + (update.skipped ?? 0),
    };
    setCounts(merged);
    setError(null);
    if (index + 1 >= queue.length) {
      setPhase("summary");
      return;
    }
    setIndex(index + 1);
    setTyped(String(queue[index + 1].quantity));
  }

  function confirm() {
    const item = queue[index];
    startTransition(async () => {
      const step = await confirmStockCheckStep(item, typed, bulkSetInventoryQuantitiesAction);
      if (step.kind === "invalid") {
        setError(t.invalidError);
        return;
      }
      if (step.kind === "corrected") {
        if (step.result.error) {
          setError(step.result.error);
          return;
        }
        showAutoAddedToast(step.result.autoAdded, dict.autoAdd);
        advance({ checked: 1, corrected: 1 });
        return;
      }
      advance({ checked: 1 });
    });
  }

  function skip() {
    advance({ skipped: 1 });
  }

  const current = queue[index];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{phase === "summary" ? t.summaryTitle : t.dialogTitle}</DialogTitle>
        </DialogHeader>

        {phase === "pick" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t.pickSubtitle}</p>
            <ul aria-label={t.pickGroupLabel} className="flex flex-col gap-2">
              {[null, ...locations].map((location) => {
                const count = buildStockCheckQueue([...items], location).length;
                return (
                  <li key={location ?? "__all"}>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 w-full justify-between"
                      disabled={count === 0}
                      onClick={() => begin(location)}
                    >
                      <span>{location ?? t.allLocations}</span>
                      <span className="text-sm font-normal text-muted-foreground">
                        {format(plural(count, t.itemCount), { count })}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {phase === "walk" && current && (
          <>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {format(t.progress, { current: index + 1, total: queue.length })}
              </p>
              <div className="flex flex-col gap-1">
                <p className="text-xl font-semibold break-words">{current.name}</p>
                <p className="text-sm text-muted-foreground">
                  {format(t.currentAmount, {
                    quantity: formatQuantity(current.quantity),
                    unit: unitLabel(current.unit, current.quantity),
                  })}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="stock-check-amount">
                  {format(t.countedLabel, { unit: unitLabel(current.unit, 2) })}
                </Label>
                <Input
                  key={current.id}
                  id="stock-check-amount"
                  type="number"
                  inputMode={inputModeForUnit(current.unit, current.quantity)}
                  min={0}
                  step="any"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => {
                    setTyped(e.target.value);
                    setError(null);
                  }}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "stock-check-error" : undefined}
                  className="h-12 text-lg"
                />
                {error && (
                  <p id="stock-check-error" role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={skip}>
                {t.skip}
              </Button>
              <Button type="button" className="h-12 flex-1 text-base sm:flex-none" disabled={pending} onClick={confirm}>
                {t.next}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === "summary" && (
          <>
            <div className="flex flex-col gap-1" aria-live="polite">
              <p className="text-lg font-semibold">
                {format(t.summary, { checked: counts.checked, corrected: counts.corrected })}
              </p>
              {counts.skipped > 0 && (
                <p className="text-sm text-muted-foreground">{format(t.summarySkipped, { skipped: counts.skipped })}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" className="h-12" onClick={() => handleOpenChange(false)}>
                {t.done}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
