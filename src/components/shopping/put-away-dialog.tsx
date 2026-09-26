"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ComboField } from "@/components/inventory/combo-field";
import { putAwayItemsAction, type PutAwayEntry } from "@/app/dashboard/shopping-list/actions";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type PutAwayItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  /** null = not linked to inventory: put away still marks it done, but
   * there's no stock to add, so the stock fields are hidden. */
  inventoryItemId: string | null;
  estimatedPrice: number | null;
  /** The linked item's current location, shown as the field's placeholder
   * so leaving it blank visibly means "stays where it is". */
  location: string | null;
};

type Choice = "putAway" | "later" | "notBought";

type RowState = {
  choice: Choice;
  quantity: string;
  expiresAt: string;
  location: string;
};

function initialRows(items: PutAwayItem[]): Record<string, RowState> {
  return Object.fromEntries(
    items.map((item) => [item.id, { choice: "putAway", quantity: String(item.quantity), expiresAt: "", location: "" }]),
  );
}

/**
 * The "Put away" step of the two-phase shopping flow (see
 * putAwayItemsAction): one row per ticked-but-not-put-away item, pre-filled
 * with the list's quantity, where the person confirms what actually came
 * home before it's counted into inventory. Each row can be put away now
 * (optionally with a corrected quantity, a best-before date and a
 * location), left for later (a partial put-away — the row stays incoming),
 * or marked "didn't get it", which un-ticks it back onto the list.
 *
 * Controlled by the list page rather than a trigger of its own, because it
 * opens from three places: the "Put away (N)" button, "Done shopping" while
 * rows are still waiting (`finishing` — then confirming also completes the
 * list, and a second button finishes without putting anything away), and a
 * receipt applied in put-away mode. Row state is rebuilt every time it
 * opens, the adjust-state-during-render way the list page already uses.
 */
export function PutAwayDialog({
  open,
  onOpenChange,
  listId,
  items,
  finishing,
  onFinish,
  numberFormat,
  locations,
  dict,
  autoAddDict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: string;
  items: PutAwayItem[];
  /** Opened from "Done shopping": offer finishing the list as well. */
  finishing: boolean;
  /** Completes the list (the page's own completeList, with its Undo toast). */
  onFinish: () => void;
  numberFormat: Intl.NumberFormat;
  locations: string[];
  dict: Dictionary["shoppingList"];
  autoAddDict: Dictionary["inventory"]["autoAdd"];
}) {
  const t = dict.putAway;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState(() => initialRows(items));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRows(initialRows(items));
      setError(null);
    }
  }

  // Items that arrived while the dialog was open (someone else ticked more)
  // get a default row rather than being silently left out.
  const rowFor = (item: PutAwayItem): RowState => rows[item.id] ?? initialRows([item])[item.id];

  function update(item: PutAwayItem, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] ?? initialRows([item])[item.id]), ...patch } }));
  }

  const putAwayCount = items.filter((item) => rowFor(item).choice === "putAway").length;
  const allPutAway = items.length > 0 && putAwayCount === items.length;

  function submit(thenFinish: boolean) {
    const entries: PutAwayEntry[] = [];
    for (const item of items) {
      const row = rowFor(item);
      if (row.choice === "later") continue;
      if (row.choice === "notBought") {
        entries.push({ itemId: item.id, notBought: true });
        continue;
      }
      const quantity = Number(row.quantity.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(format(t.quantityInvalid, { name: item.name }));
        return;
      }
      entries.push({
        itemId: item.id,
        quantity,
        ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
        ...(row.location.trim() ? { location: row.location.trim() } : {}),
      });
    }

    setError(null);
    startTransition(async () => {
      if (entries.length > 0) {
        const result = await putAwayItemsAction(listId, entries);
        if (result.error) {
          setError(result.error);
          return;
        }
        const putAway = result.putAway ?? 0;
        const notBought = result.notBought ?? 0;
        if (putAway > 0) toast.success(format(plural(putAway, t.doneToast), { count: putAway }));
        if (notBought > 0) toast.info(format(plural(notBought, t.notBoughtToast), { count: notBought }));
        showAutoAddedToast(result.autoAdded, autoAddDict);
      }
      onOpenChange(false);
      if (thenFinish) onFinish();
    });
  }

  const confirmLabel = allPutAway
    ? t.confirmAll
    : putAwayCount > 0
      ? format(plural(putAwayCount, t.confirm), { count: putAwayCount })
      : t.save;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{finishing ? t.finishTitle : t.title}</DialogTitle>
          <DialogDescription>{finishing ? t.finishDescription : t.description}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {items.map((item) => {
            const row = rowFor(item);
            const linked = item.inventoryItemId !== null;
            return (
              <div key={item.id} className="flex flex-col gap-2 rounded-md border p-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 text-sm font-medium break-words">
                    {item.name}
                    {item.estimatedPrice != null && (
                      <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                        ≈ {numberFormat.format(item.estimatedPrice)}
                      </span>
                    )}
                  </p>
                  <div
                    role="radiogroup"
                    aria-label={format(t.optionAriaLabel, { name: item.name })}
                    className="flex w-fit shrink-0 gap-1 rounded-lg bg-muted p-1"
                  >
                    {(["putAway", "later", "notBought"] as const).map((choice) => (
                      <Button
                        key={choice}
                        type="button"
                        role="radio"
                        aria-checked={row.choice === choice}
                        variant={row.choice === choice ? "secondary" : "ghost"}
                        size="sm"
                        disabled={pending}
                        onClick={() => update(item, { choice })}
                      >
                        {t.options[choice]}
                      </Button>
                    ))}
                  </div>
                </div>

                {row.choice === "putAway" &&
                  (linked ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_1fr_1fr]">
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {format(t.quantityLabel, { unit: item.unit })}
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={row.quantity}
                          disabled={pending}
                          onChange={(e) => update(item, { quantity: e.target.value })}
                          aria-label={format(t.quantityAriaLabel, { name: item.name })}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {t.expiresLabel}
                        <Input
                          type="date"
                          value={row.expiresAt}
                          disabled={pending}
                          onChange={(e) => update(item, { expiresAt: e.target.value })}
                          aria-label={format(t.expiresAriaLabel, { name: item.name })}
                        />
                      </label>
                      <div className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1">
                        <label htmlFor={`put-away-${item.id}-location`}>{t.locationLabel}</label>
                        <ComboField
                          id={`put-away-${item.id}-location`}
                          name="location"
                          items={locations}
                          value={row.location}
                          onValueChange={(value) => update(item, { location: value })}
                          placeholder={item.location ?? t.locationPlaceholder}
                          maxLength={120}
                          dict={dict}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t.notLinkedHint}</p>
                  ))}
              </div>
            );
          })}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {finishing ? (
            // Finishing without putting away is allowed, not lost: the rows
            // stay ticked on the completed list, still count as on their
            // way, and the "Put away" button and the reminder still find
            // them there.
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                onOpenChange(false);
                onFinish();
              }}
            >
              {t.finishLater}
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              {t.cancel}
            </Button>
          )}
          <Button type="button" disabled={pending} onClick={() => submit(finishing)}>
            {pending ? t.confirming : finishing ? t.finishConfirm : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
