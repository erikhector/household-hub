"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";
import { mergeInventoryItemsAction, previewMergeAction, type MergePreview } from "@/app/dashboard/inventory/items/actions";
import { mergeUnitFactor, planMerge } from "@/lib/inventory/merge";
import { conversionSentence, factorFromSentence } from "@/lib/inventory/item-units";
import { conversionLeadUnit } from "@/lib/recipes/unit-hints";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import { format, plural } from "@/lib/i18n/format";

type CatalogDict = Dictionary["inventory"]["catalog"];
type Counts = MergePreview["items"][number]["counts"];
const COUNT_KEYS = ["recipes", "listRows", "templates", "prices", "aliases", "conversions"] as const satisfies readonly (keyof Counts)[];

/**
 * The merge dialog's body (MATCH-7, design §6.3, "Confirm, not undo"):
 * loads previewMergeAction once, then shows exactly what moves from each
 * merged item and what the keeper ends up with, through the same
 * planMerge the merge runs. A unit that can't be converted asks for a
 * factor inline. Merge is the only button that writes.
 */
export function MergePreviewBody({
  keeperId,
  mergeIds,
  dict,
  locale,
  onCancel,
  onMerged,
}: {
  keeperId: string;
  mergeIds: string[];
  dict: CatalogDict;
  locale: Locale;
  onCancel: () => void;
  onMerged: () => void;
}) {
  const copy = dict.mergeDialog;
  const idPrefix = useId();
  const [result, setResult] = useState<Awaited<ReturnType<typeof previewMergeAction>> | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const mergeKey = mergeIds.join(",");

  useEffect(() => {
    let cancelled = false;
    previewMergeAction(keeperId, mergeKey.split(",")).then((next) => {
      if (!cancelled) setResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [keeperId, mergeKey]);

  if (result === null) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {copy.loading}
      </p>
    );
  }
  if ("error" in result) {
    return (
      <>
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {copy.cancel}
          </Button>
        </DialogFooter>
      </>
    );
  }

  const { keeper, items } = result.preview;
  const factors = new Map<string, number>();
  for (const item of items) {
    const factor = typed[item.id] ? factorFromSentence(item.unit, keeper.unit, typed[item.id]) : null;
    if (factor !== null) factors.set(item.id, factor);
  }
  const { plan, missingFactor, badFactor } = planMerge(keeper, items, factors);
  const ready = missingFactor.length === 0 && badFactor.length === 0;
  const planned = new Map(plan.items.map((entry) => [entry.id, entry]));
  const amount = (value: number, unit: string) => `${value} ${unit}`;
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });

  const handleMerge = () =>
    startTransition(async () => {
      setMergeError(null);
      const next = await mergeInventoryItemsAction({
        keeperId: keeper.id,
        merge: items.map((item) => ({ id: item.id, factor: factors.get(item.id) })),
      });
      if (next.error) {
        setMergeError(next.error);
        return;
      }
      toast.success(format(copy.merged, { name: keeper.name }));
      onMerged();
    });

  const outcome = [
    format(copy.stock, { before: amount(keeper.quantity, keeper.unit), after: amount(plan.quantity, keeper.unit) }),
    ...(plan.fromMerged.barcode && plan.barcode ? [format(copy.barcodeTaken, { barcode: plan.barcode })] : []),
    ...plan.droppedBarcodes.map((barcode) => format(copy.barcodeDropped, { barcode, name: keeper.name })),
    ...(plan.fromMerged.expiresAt && plan.expiresAt ? [format(copy.expiry, { date: dateFormat.format(plan.expiresAt) })] : []),
    ...(plan.fromMerged.lowStockThreshold
      ? [format(copy.threshold, { amount: amount(plan.lowStockThreshold, keeper.unit) })]
      : []),
    ...(plan.fromMerged.lastKnownPrice && plan.lastKnownPrice !== null
      ? [format(copy.price, { price: plan.lastKnownPrice.toFixed(2) })]
      : []),
    ...(plan.fromMerged.category ? [format(copy.category, { category: plan.category })] : []),
    ...plan.conversions.map((conversion) => {
      const sentence = conversionSentence(conversion.fromUnit, conversion.factor, keeper.unit);
      return format(copy.conversion, {
        sentence: `1 ${sentence.leadUnit} = ${sentence.amount} ${sentence.otherUnit}`,
      });
    }),
    ...plan.aliases.map((name) => format(copy.alias, { name, keeper: keeper.name })),
    format(copy.deletes, { names: items.map((item) => item.name).join(", ") }),
  ];

  return (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const needsFactor = mergeUnitFactor(keeper, item) === null;
          const lead = conversionLeadUnit(item.unit, keeper.unit) === "item" ? keeper.unit : item.unit;
          const other = lead === keeper.unit ? item.unit : keeper.unit;
          const counts = COUNT_KEYS.filter((key) => item.counts[key] > 0).map((key) =>
            format(plural(item.counts[key], copy.counts[key]), { count: item.counts[key] }),
          );
          const entry = planned.get(item.id);
          const inputId = `${idPrefix}-${item.id}`;
          return (
            <li key={item.id} className="flex min-w-0 flex-col gap-2 rounded-md border p-3 text-sm">
              <p className="font-medium break-words">{item.name}</p>
              {entry && (
                <p>
                  {format(copy.adds, {
                    amount: amount(item.quantity, item.unit),
                    converted: amount(entry.quantity, keeper.unit),
                  })}
                </p>
              )}
              {needsFactor && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-muted-foreground">{format(copy.needsFactor, { from: item.unit, to: keeper.unit })}</p>
                  <Label htmlFor={inputId}>{format(copy.factorLabel, { lead, other })}</Label>
                  <Input
                    id={inputId}
                    type="text"
                    inputMode="decimal"
                    className="w-32"
                    value={typed[item.id] ?? ""}
                    onChange={(event) => setTyped((current) => ({ ...current, [item.id]: event.target.value }))}
                    aria-invalid={badFactor.includes(item.id) || (Boolean(typed[item.id]) && !entry)}
                  />
                </div>
              )}
              <p className="text-muted-foreground">
                {counts.length > 0 ? `${copy.moves}: ${counts.join(" · ")}` : copy.nothingLinked}
              </p>
            </li>
          );
        })}
      </ul>
      <section className="flex flex-col gap-1.5" aria-live="polite">
        <h3 className="text-sm font-semibold">{copy.outcome}</h3>
        <ul className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
          {outcome.map((line) => (
            <li key={line} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      </section>
      {mergeError && (
        <p role="alert" className="text-sm text-destructive">
          {mergeError}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {copy.cancel}
        </Button>
        <Button type="button" variant="destructive" disabled={!ready || isPending} onClick={handleMerge}>
          {isPending ? copy.merging : copy.merge}
        </Button>
      </DialogFooter>
    </>
  );
}
