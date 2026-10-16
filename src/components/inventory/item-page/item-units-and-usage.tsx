"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck, Pencil, Plus, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ComboField } from "@/components/inventory/combo-field";
import { deleteUnitConversionAction, saveUnitConversionAction } from "@/app/dashboard/inventory/items/actions";
import { conversionSentence, factorFromSentence, roundAmount, type UsedInRow } from "@/lib/inventory/item-units";
import { unitConversionHint } from "@/lib/recipes/unit-hints";
import { canonicalUnit, convertForItem } from "@/lib/units";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";
import { useUnitLabel } from "@/components/units-provider";
import { PendingLabel } from "@/components/ui/pending-label";

type ItemPageDict = Dictionary["inventory"]["itemPage"];
type ComboDict = Pick<Dictionary["inventory"], "comboboxNoMatches" | "comboboxAddNew">;

type Conversion = { id: string; fromUnit: string; factor: number };

// Three significant digits, like the recipe review's hints: "60", "0.15".
const short = (value: number) => String(Number(value.toPrecision(3)));

// What the conversion dialog opens with: an existing row to edit, or a
// unit to add (from a ⚠ recipe row, or blank from "Add conversion").
type DialogState = { conversionId: string | null; fromUnit: string; amount: string; fromHint: boolean };

// The item page's Units and Used in sections (MATCH-6, design §6.1). One
// component because a ⚠ recipe row's "Add cup…" opens the same
// add-conversion dialog the Units section does, pre-filled with its unit.
export function ItemUnitsAndUsage({
  item,
  conversions,
  rows,
  units,
  dict,
  comboDict,
}: {
  item: { id: string; name: string; unit: string };
  conversions: Conversion[];
  rows: (UsedInRow & { convertedLabel: string | null })[];
  units: string[];
  dict: ItemPageDict;
  comboDict: ComboDict;
}) {
  const unitLabel = useUnitLabel();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [isPending, startTransition] = useTransition();

  // A new row starts from the ≈ density hint (unit-hints.ts) when the
  // staple list covers the item and both units, like the recipe review.
  const hintAmount = (fromUnit: string) => {
    const hint = fromUnit.trim() ? unitConversionHint(item.name, fromUnit, item.unit) : null;
    return hint === null ? null : short(conversionSentence(fromUnit, hint, item.unit).amount);
  };
  const openAdd = (fromUnit: string) => {
    const hint = hintAmount(fromUnit);
    setDialog({ conversionId: null, fromUnit, amount: hint ?? "", fromHint: hint !== null });
  };
  const openEdit = (conversion: Conversion) =>
    setDialog({
      conversionId: conversion.id,
      fromUnit: conversion.fromUnit,
      amount: String(conversionSentence(conversion.fromUnit, conversion.factor, item.unit).amount),
      fromHint: false,
    });

  const handleDelete = (conversionId: string) =>
    new Promise<ActionState>((resolve) =>
      startTransition(async () => {
        resolve(await deleteUnitConversionAction(conversionId));
      }),
    );

  return (
    <>
      <section aria-labelledby="units" className="flex flex-col gap-3">
        <h2 id="units" className="font-heading text-lg font-semibold">
          {dict.unitsTitle}
        </h2>
        <p className="text-sm">{format(dict.countedIn, { unit: unitLabel(item.unit) })}</p>
        {conversions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{format(dict.noConversions, { unit: unitLabel(item.unit) })}</p>
        ) : (
          <ul className="list-bleed flex flex-col divide-y rounded-md border">
            {conversions.map((conversion) => {
              const sentence = conversionSentence(conversion.fromUnit, conversion.factor, item.unit);
              return (
                <li key={conversion.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 text-sm break-words">
                    1 {unitLabel(sentence.leadUnit)} = {sentence.amount} {unitLabel(sentence.otherUnit)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={format(dict.editConversionAriaLabel, { unit: unitLabel(conversion.fromUnit) })}
                    onClick={() => openEdit(conversion)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={isPending}
                        aria-label={format(dict.deleteConversionAriaLabel, { unit: unitLabel(conversion.fromUnit) })}
                      >
                        <X className="size-3.5" />
                      </Button>
                    }
                    title={format(dict.confirmDeleteConversion.title, { unit: unitLabel(conversion.fromUnit) })}
                    description={format(dict.confirmDeleteConversion.description, { unit: unitLabel(conversion.fromUnit) })}
                    cancelLabel={dict.confirmDeleteConversion.cancel}
                    confirmLabel={dict.confirmDeleteConversion.confirm}
                    pendingLabel={dict.confirmDeleteConversion.confirming}
                    onConfirm={() => handleDelete(conversion.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => openAdd("")}>
          <Plus />
          {dict.addConversion}
        </Button>
        <TryIt item={item} conversions={conversions} units={units} dict={dict} comboDict={comboDict} />
      </section>

      <section aria-labelledby="used-in" className="flex flex-col gap-3">
        <h2 id="used-in" className="font-heading text-lg font-semibold">
          {format(plural(rows.length, dict.usedIn), { count: rows.length })}
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.notUsed}</p>
        ) : (
          <ul className="list-bleed flex flex-col divide-y rounded-md border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <Link
                  href={`/dashboard/meal-planning?tab=recipes&recipe=${encodeURIComponent(row.recipeId)}`}
                  className="touch-target min-w-0 flex-1 basis-32 font-medium break-words underline-offset-4 hover:underline"
                >
                  {row.recipeName}
                </Link>
                <span className="text-muted-foreground">
                  {row.quantity} {unitLabel(row.unit)}
                </span>
                {row.convertedLabel !== null ? (
                  <span className="flex items-center gap-1">
                    = {row.convertedLabel} {unitLabel(item.unit)}
                    <CircleCheck className="size-3.5 text-primary" role="img" aria-label={dict.converts} />
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <TriangleAlert
                      className="size-3.5 text-warning"
                      role="img"
                      aria-label={format(dict.cantConvert, { unit: unitLabel(row.unit), itemUnit: unitLabel(item.unit) })}
                    />
                    <Button type="button" variant="outline" size="xs" onClick={() => openAdd(canonicalUnit(row.unit))}>
                      {format(dict.addUnit, { unit: unitLabel(row.unit) })}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConversionDialog
        key={dialog ? `${dialog.conversionId ?? "new"}-${dialog.fromUnit}` : "closed"}
        state={dialog}
        onClose={() => setDialog(null)}
        item={item}
        units={units}
        hintAmount={hintAmount}
        dict={dict}
        comboDict={comboDict}
      />
    </>
  );
}

// "Try it" (design §6.1): a live calculator over the same convertForItem
// the rest of the app uses, so a factor can be checked before it's
// trusted. Nothing is saved.
function TryIt({
  item,
  conversions,
  units,
  dict,
  comboDict,
}: {
  item: { unit: string };
  conversions: Conversion[];
  units: string[];
  dict: ItemPageDict;
  comboDict: ComboDict;
}) {
  const unitLabel = useUnitLabel();
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState(units.find((candidate) => canonicalUnit(candidate) !== canonicalUnit(item.unit)) ?? item.unit);
  const quantity = Number(amount.trim().replace(",", "."));
  const result =
    amount.trim() && Number.isFinite(quantity) && unit.trim() ? convertForItem(quantity, unit, item, conversions) : null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{dict.tryIt}</span>
      <Input
        autoComplete="off"
        type="text"
        inputMode="decimal"
        className="w-20"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        aria-label={dict.tryItAmountLabel}
      />
      <div className="w-28 max-sm:w-44 pointer-coarse:w-44">
        <ComboField
          id="try-it-unit"
          items={units}
          value={unit}
          onValueChange={setUnit}
          maxLength={20}
          dict={comboDict}
        />
      </div>
      <span aria-live="polite" data-testid="try-it-result">
        {result === null ? dict.tryItNoResult : `= ${short(roundAmount(result))} ${unitLabel(item.unit)}`}
      </span>
    </div>
  );
}

function ConversionDialog({
  state,
  onClose,
  item,
  units,
  hintAmount,
  dict,
  comboDict,
}: {
  state: DialogState | null;
  onClose: () => void;
  item: { id: string; unit: string };
  units: string[];
  hintAmount: (fromUnit: string) => string | null;
  dict: ItemPageDict;
  comboDict: ComboDict;
}) {
  const unitLabel = useUnitLabel();
  const copy = dict.conversionDialog;
  const [fromUnit, setFromUnit] = useState(state?.fromUnit ?? "");
  const [amount, setAmount] = useState(state?.amount ?? "");
  const [fromHint, setFromHint] = useState(state?.fromHint ?? false);
  const [result, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const next = await saveUnitConversionAction(prev, formData);
    if (!next.error) onClose();
    return next;
  }, {});

  const unitTyped = fromUnit.trim() !== "";
  const sentence = unitTyped ? conversionSentence(fromUnit, 1, item.unit) : null;
  const factor = unitTyped ? factorFromSentence(fromUnit, item.unit, amount) : null;

  // A changed unit re-reads the hint while the amount is still the hint
  // (or empty), so it never overwrites something the user typed.
  const handleUnitChange = (next: string) => {
    setFromUnit(next);
    if (fromHint || !amount.trim()) {
      const hint = hintAmount(next);
      setAmount(hint ?? "");
      setFromHint(hint !== null);
    }
  };

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.conversionId ? copy.editTitle : copy.addTitle}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="itemId" value={item.id} />
          {state?.conversionId && <input type="hidden" name="conversionId" value={state.conversionId} />}
          <input type="hidden" name="factor" value={factor ?? ""} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="conversion-unit">{copy.unitLabel}</Label>
            <ComboField
              id="conversion-unit"
              name="fromUnit"
              items={units.filter((unit) => canonicalUnit(unit) !== canonicalUnit(item.unit))}
              value={fromUnit}
              onValueChange={handleUnitChange}
              placeholder={copy.unitPlaceholder}
              maxLength={20}
              dict={comboDict}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="conversion-amount">{copy.amountLabel}</Label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>1 {sentence ? unitLabel(sentence.leadUnit) : "…"} =</span>
              <Input
                autoComplete="off"
                id="conversion-amount"
                type="text"
                inputMode="decimal"
                className="w-28"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setFromHint(false);
                }}
                aria-invalid={amount.trim() !== "" && unitTyped && factor === null}
                required
              />
              <span>{sentence ? unitLabel(sentence.otherUnit) : "…"}</span>
            </div>
            {fromHint && <p className="text-xs text-muted-foreground">{copy.typical}</p>}
          </div>
          {result.error && (
            <p role="alert" className="text-sm text-destructive">
              {result.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {copy.cancel}
            </Button>
            <Button type="submit" disabled={pending || factor === null}>
              <PendingLabel pending={pending} busy={copy.saving} idle={copy.save} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
