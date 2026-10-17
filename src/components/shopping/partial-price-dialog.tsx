"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogHandle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

/**
 * UX-87: the step between "Done shopping" and the budget when only some of
 * the bought items carry a price. Logging the sum of the priced rows as the
 * trip's cost would record a fraction of it with no hint, so the user sees
 * how many rows are unpriced and either corrects the amount to the real
 * total or skips logging. Only offered when at least one bought row is
 * priced and at least one isn't: all-priced completes as before, and
 * nothing priced logs nothing anyway.
 *
 * The amount lives in an inner component under DialogContent so each
 * opening starts from the current sum, not from the last edit.
 */
export function PartialPriceDialog({
  handle,
  suggested,
  unpriced,
  total,
  dict,
  onConfirm,
}: {
  handle: DialogHandle;
  /** Sum of the priced bought rows — the pre-filled amount. */
  suggested: number;
  unpriced: number;
  total: number;
  dict: Dictionary["shoppingList"]["partialPrice"];
  /** `null` = complete without logging anything. */
  onConfirm: (amount: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen} handle={handle}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.title}</DialogTitle>
          <DialogDescription>
            {format(plural(unpriced, dict.description), { unpriced, total })}
          </DialogDescription>
        </DialogHeader>
        <PartialPriceForm
          suggested={suggested}
          dict={dict}
          onConfirm={(amount) => {
            setOpen(false);
            onConfirm(amount);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function PartialPriceForm({
  suggested,
  dict,
  onConfirm,
}: {
  suggested: number;
  dict: Dictionary["shoppingList"]["partialPrice"];
  onConfirm: (amount: number | null) => void;
}) {
  // Rounded so a float sum like 24.900000000000002 doesn't land in the field.
  const [value, setValue] = useState(String(Math.round(suggested * 100) / 100));
  const amount = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onConfirm(amount);
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {dict.amountLabel}
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={!valid}
        />
      </label>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onConfirm(null)}>
          {dict.skip}
        </Button>
        <Button type="submit" disabled={!valid}>
          {dict.log}
        </Button>
      </DialogFooter>
    </form>
  );
}
