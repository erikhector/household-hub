"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatQuantity } from "@/lib/format-quantity";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { parseAmount, quantityPresets } from "@/lib/inventory/quantity-step";

// UX-119: the last amount used or bought per item, in memory only. It offers
// "Last 200 g" as a one-tap chip the next time the sheet opens in this tab,
// and is deliberately not stored in the browser (cookie-inventory.ts): it is
// a convenience, not a preference worth persisting.
const lastAmounts = new Map<string, number>();

type Mode = "used" | "bought";

/**
 * "I used some / I bought more": opened by tapping an inventory row's
 * quantity. The −/+ stepper moves by one step, which is slow for 200 g, so
 * this takes the amount directly. Every chip applies at once (tap the
 * quantity, tap "200 g": two taps), and a typed amount has its own button.
 * `onApply` gets the signed change; the stepper's optimistic transition and
 * the server's own rounding and zero floor do the rest.
 */
export function QuantitySheet({
  open,
  onOpenChange,
  itemId,
  itemName,
  quantity,
  unitText,
  unit,
  onApply,
  dict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  itemName: string;
  quantity: number;
  unitText: string;
  unit: string;
  onApply: (delta: number) => void;
  dict: Dictionary["inventory"]["quantitySheet"];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{itemName}</DialogTitle>
          <DialogDescription>{format(dict.description, { amount: `${formatQuantity(quantity)} ${unitText}` })}</DialogDescription>
        </DialogHeader>
        {/* Inside DialogContent so each opening starts on "Used" with an empty field. */}
        <QuantitySheetBody
          itemId={itemId}
          quantity={quantity}
          unitText={unitText}
          unit={unit}
          dict={dict}
          onApply={(delta) => {
            onOpenChange(false);
            onApply(delta);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function QuantitySheetBody({
  itemId,
  quantity,
  unitText,
  unit,
  dict,
  onApply,
}: {
  itemId: string;
  quantity: number;
  unitText: string;
  unit: string;
  dict: Dictionary["inventory"]["quantitySheet"];
  onApply: (delta: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("used");
  const [value, setValue] = useState("");
  const typed = parseAmount(value);
  const last = lastAmounts.get(itemId);
  const sign = mode === "used" ? -1 : 1;

  function apply(amount: number) {
    lastAmounts.set(itemId, amount);
    onApply(sign * amount);
  }

  const half = Math.round((quantity / 2) * 100) / 100;
  const chips: { key: string; label: string; amount: number }[] = [
    ...quantityPresets(unit).map((amount) => ({
      key: `p${amount}`,
      label: `${formatQuantity(amount)} ${unitText}`,
      amount,
    })),
    ...(half > 0 ? [{ key: "half", label: "½", amount: half }] : []),
    ...(mode === "used" && quantity > 0 ? [{ key: "all", label: dict.all, amount: quantity }] : []),
    ...(last
      ? [{ key: "last", label: format(dict.last, { amount: `${formatQuantity(last)} ${unitText}` }), amount: last }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={dict.modeLabel}>
        {(["used", "bought"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            variant={mode === option ? "default" : "outline"}
            aria-pressed={mode === option}
            onClick={() => setMode(option)}
          >
            {option === "used" ? dict.used : dict.bought}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={dict.chipsLabel}>
        {chips.map((chip) => (
          <Button key={chip.key} type="button" variant="secondary" onClick={() => apply(chip.amount)}>
            {chip.label}
          </Button>
        ))}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed !== null) apply(typed);
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          {format(dict.amountLabel, { unit: unitText })}
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={typed === null}>
          {mode === "used" ? dict.applyUsed : dict.applyBought}
        </Button>
      </form>
    </div>
  );
}
