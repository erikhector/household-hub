"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ComboField, type ComboFieldDict } from "@/components/inventory/combo-field";
import { changeItemUnitAction } from "@/app/dashboard/inventory/items/actions";
import { planUnitChange, suggestedUnitChangeFactor, type UnitChangeItem } from "@/lib/inventory/item-units";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { useUnitLabel } from "@/components/units-provider";
import { PendingLabel } from "@/components/ui/pending-label";

type ItemPageDict = Dictionary["inventory"]["itemPage"];

// "Change unit…" (MATCH-6, design §6.1): the one place stock is converted
// between units. The factor starts from the generic table or a saved
// conversion (suggestedUnitChangeFactor), and the before/after preview is
// the same planUnitChange the Server Action applies.
export function ChangeUnitDialog({
  item,
  units,
  dict,
  comboDict,
}: {
  item: UnitChangeItem & { id: string };
  units: string[];
  dict: ItemPageDict;
  comboDict: ComboFieldDict;
}) {
  const unitLabel = useUnitLabel();
  const copy = dict.changeUnitDialog;
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState("");
  const [factor, setFactor] = useState("");
  // Whether the factor is still the suggestion (or empty), so a changed
  // unit may replace it without overwriting a typed number.
  const [factorSuggested, setFactorSuggested] = useState(true);
  const [result, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const next = await changeItemUnitAction(prev, formData);
    if (!next.error) setOpen(false);
    return next;
  }, {});

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setUnit("");
      setFactor("");
      setFactorSuggested(true);
    }
  };

  const handleUnitChange = (next: string) => {
    setUnit(next);
    if (factorSuggested) {
      const suggested = suggestedUnitChangeFactor(item.unit, next, item.conversions);
      setFactor(suggested === null ? "" : String(suggested));
    }
  };

  const typedFactor = Number(factor.trim().replace(",", "."));
  const outcome = unit.trim() && factor.trim() ? planUnitChange(item, unit, typedFactor) : null;
  const plan = outcome && "plan" in outcome ? outcome.plan : null;
  const problem = outcome && "problem" in outcome ? dict.errors[outcome.problem] : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            {dict.changeUnit}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{format(copy.description, { unit: unitLabel(item.unit) })}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="itemId" value={item.id} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="change-unit-unit">{copy.newUnitLabel}</Label>
            <ComboField
              id="change-unit-unit"
              name="unit"
              items={units.filter((candidate) => candidate !== item.unit)}
              value={unit}
              onValueChange={handleUnitChange}
              maxLength={20}
              label={copy.newUnitLabel}
              dict={comboDict}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="change-unit-factor">
              {format(copy.factorLabel, { from: unitLabel(item.unit), to: unit.trim() ? unitLabel(unit.trim()) : "…" })}
            </Label>
            <Input
              autoComplete="off"
              enterKeyHint="done"
              id="change-unit-factor"
              name="factor"
              type="text"
              inputMode="decimal"
              className="w-32"
              value={factor}
              onChange={(event) => {
                setFactor(event.target.value);
                setFactorSuggested(event.target.value.trim() === "");
              }}
              aria-invalid={problem !== null}
              required
            />
          </div>
          {plan && (
            <ul className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm" aria-live="polite">
              <li>
                {format(copy.stock, {
                  before: `${item.quantity} ${unitLabel(item.unit)}`,
                  after: `${plan.quantity} ${unitLabel(plan.unit)}`,
                })}
              </li>
              <li>
                {format(copy.threshold, {
                  before: `${item.lowStockThreshold} ${unitLabel(item.unit)}`,
                  after: `${plan.lowStockThreshold} ${unitLabel(plan.unit)}`,
                })}
              </li>
            </ul>
          )}
          {(result.error || problem) && (
            <p role="alert" className="text-sm text-destructive">
              {result.error ?? problem}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {copy.cancel}
            </Button>
            <Button type="submit" disabled={pending || plan === null}>
              <PendingLabel pending={pending} busy={copy.saving} idle={copy.save} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
