"use client";

import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboField } from "@/components/inventory/combo-field";
import { quickAddInventoryItemAction } from "@/app/dashboard/inventory/actions";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

/**
 * Rapid entry for stocking a shelf at a time: name + quantity + unit +
 * category in one row. Enter moves focus to the next field and only Enter in
 * the last one (category) commits the row, so it can't add half an item
 * (UX-132); the + button still adds from anywhere. After a commit the name is
 * refocused for the next item — quantity, unit, and category stay put
 * between rows (a shelf is usually one category, and 1-2 units, at a time),
 * so only the name needs retyping. No dialog round trip either way.
 */
export function QuickAddBar({
  dict,
  categories,
  units,
}: {
  dict: Dictionary["inventory"];
  categories: string[];
  units: string[];
}) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("pcs");
  const [category, setCategory] = useState("");
  const [addedCount, setAddedCount] = useState(0);
  const [isPending, startTransition] = useTransition();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const trimmedName = name.trim();
    if (!trimmedName || isPending) return;

    startTransition(async () => {
      const result = await quickAddInventoryItemAction({
        name: trimmedName,
        quantity: Number(quantity) || 1,
        unit: unit.trim() || "pcs",
        category: category.trim() || undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setAddedCount((count) => count + 1);
      setName("");
      nameInputRef.current?.focus();
    });
  };

  // Handling Enter directly on keydown (rather than relying on native
  // implicit form submission) sidesteps base-ui's Field.Control, which
  // intercepts Enter on its own terms and doesn't reliably let it reach a
  // plain `<form onSubmit>` here. Enter walks name -> quantity -> unit ->
  // category and only the last field submits (UX-132).
  const focusField = (id: string) => document.getElementById(id)?.focus();
  const handleEnterTo =
    (nextId: string) => (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
      e.preventDefault();
      focusField(nextId);
    };

  return (
    <div className="flex w-full max-w-md flex-col gap-1.5">
      {/* Wraps on phones with the name on its own line: inside the empty
          state's padded card the row is under ~300px wide, and five fields
          side by side left the flexible columns too narrow to use — while
          their inputs' intrinsic width (flex items default to
          min-width: auto) pushed the row past the viewport, giving `main`
          a horizontal scroll. min-w-0 on the flex-1 columns lets them
          actually shrink instead. */}
      <div className="flex flex-wrap items-end gap-1.5 sm:flex-nowrap">
        <div className="flex min-w-0 basis-full flex-col gap-1 sm:flex-1 sm:basis-0">
          <Label htmlFor="quick-add-name" className="text-xs font-normal text-muted-foreground">
            {dict.nameLabel}
          </Label>
          <Input
            autoComplete="off"
            ref={nameInputRef}
            id="quick-add-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleEnterTo("quick-add-quantity")}
            placeholder={dict.quickAdd.placeholder}
            maxLength={120}
            disabled={isPending}
            autoFocus
          />
        </div>
        <div className="flex w-16 flex-col gap-1">
          <Label htmlFor="quick-add-quantity" className="text-xs font-normal text-muted-foreground">
            {dict.quantityLabel}
          </Label>
          <Input
            enterKeyHint="next"
            id="quick-add-quantity"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={handleEnterTo("quick-add-unit")}
            disabled={isPending}
          />
        </div>
        {/* w-32, not w-20: the combobox also holds its clear (×) and chevron
            buttons plus padding and border (~74px), so 80px left the input
            about 6px and "pcs" showed as a single letter (UX-1). */}
        <div className="flex w-32 flex-col gap-1 max-sm:w-auto max-sm:min-w-36 max-sm:flex-1">
          <Label htmlFor="quick-add-unit" className="text-xs font-normal text-muted-foreground">
            {dict.unitLabel}
          </Label>
          <ComboField
            id="quick-add-unit"
            name="unit"
            items={units}
            browseOnTap
            value={unit}
            onValueChange={setUnit}
            onEnter={() => focusField("quick-add-category")}
            maxLength={20}
            label={dict.unitLabel}
            dict={dict}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 max-sm:min-w-40">
          <Label htmlFor="quick-add-category" className="text-xs font-normal text-muted-foreground">
            {dict.categoryLabel}
          </Label>
          <ComboField
            id="quick-add-category"
            name="category"
            items={categories}
            value={category}
            onValueChange={setCategory}
            onEnter={submit}
            placeholder={dict.categoryPlaceholder}
            maxLength={60}
            label={dict.categoryLabel}
            dict={dict}
          />
        </div>
        <Button
          type="button"
          size="icon"
          disabled={isPending || !name.trim()}
          aria-label={dict.quickAdd.add}
          onClick={submit}
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {addedCount > 0
          ? format(dict.quickAdd.addedCountHint, { count: addedCount })
          : format(dict.quickAdd.hint, { category: dict.uncategorized })}
      </p>
    </div>
  );
}

/**
 * UX-50: the empty inventory's one primary is "Add item"; typing a shelf's
 * worth in one go is the second way in, so it waits behind a text button
 * instead of sitting open beside the primary as a second purple "+".
 */
export function QuickAddDisclosure({
  dict,
  categories,
  units,
}: {
  dict: Dictionary["inventory"];
  categories: string[];
  units: string[];
}) {
  const [open, setOpen] = useState(false);
  if (open) return <QuickAddBar dict={dict} categories={categories} units={units} />;
  return (
    <Button type="button" variant="link" size="sm" onClick={() => setOpen(true)}>
      {dict.quickAddToggle}
    </Button>
  );
}
