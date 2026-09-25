"use client";

import { useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { smartAddShoppingListItemsAction } from "@/app/dashboard/shopping-list/actions";
import { findItemByBarcodeAction } from "@/lib/actions/barcode";
import { BarcodeScannerButton } from "@/components/shared/barcode-scanner";
import { format, plural } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import {
  parseSmartAddInput,
  rankSmartAddSuggestions,
  rowsForSuggestion,
  splitSmartAddInput,
  type SmartAddCandidate,
  type SmartAddRow,
} from "@/lib/shopping/smart-add-suggestions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

/**
 * The shopping list's primary add path (AUTO-1): one always-visible line
 * where "2 l mjölk, bröd, 6 ägg" + Enter adds three items, with an
 * autocomplete dropdown for the item being typed (see
 * rankSmartAddSuggestions for the order). Same rhythm as the inventory's
 * QuickAddBar — commit, clear, keep focus, type the next one — with no
 * dialog in between. ShoppingItemFormDialog is still there for editing a
 * row and for the advanced add (explicit link/create).
 *
 * The scan button next to it (AUTO-6) adds a remembered barcode's item in
 * one scan, through the same action and dedupe as a typed name. An unknown
 * code never blocks: its Open Food Facts name (if any) is dropped into the
 * input for the user to check and press Enter, same as typing it.
 */
export function SmartAddBar({
  listId,
  candidates,
  pendingInventoryItemIds,
  dict,
  barcodeDict,
  onAdded,
}: {
  listId: string;
  candidates: SmartAddCandidate[];
  /** Inventory items already pending on this list — not worth suggesting. */
  pendingInventoryItemIds: string[];
  dict: Dictionary["shoppingList"]["smartAdd"];
  barcodeDict: Dictionary["barcodeScanner"];
  onAdded: (shoppingListItemIds: string[]) => void;
}) {
  const [value, setValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const query = splitSmartAddInput(value).current?.name ?? "";
  const suggestions = rankSmartAddSuggestions(query, candidates, {
    excludeIds: new Set(pendingInventoryItemIds),
  });
  const open = focused && !dismissed && suggestions.length > 0;
  const activeSuggestion = open ? suggestions[activeIndex] : undefined;

  const commit = (rows: SmartAddRow[]) => {
    if (rows.length === 0) return;
    // Cleared up front rather than after the round trip, so the next item
    // can be typed straight away; only put back if the add fails and the
    // user hasn't started on something else meanwhile.
    const submitted = value;
    setValue("");
    setActiveIndex(-1);
    inputRef.current?.focus();

    startTransition(async () => {
      const result = await smartAddShoppingListItemsAction(listId, rows);
      if (result.error) {
        toast.error(result.error);
        setValue((current) => current || submitted);
        return;
      }
      reportAdded(result);
    });
  };

  const reportAdded = (result: { addedIds?: string[]; alreadyOnList?: string[] }) => {
    const addedIds = result.addedIds ?? [];
    const alreadyOnList = result.alreadyOnList ?? [];
    if (addedIds.length > 0) {
      onAdded(addedIds);
      setAnnouncement(format(plural(addedIds.length, dict.addedAnnouncement), { count: addedIds.length }));
    }
    if (alreadyOnList.length > 0) {
      toast.info(format(plural(alreadyOnList.length, dict.alreadyOnList), { names: alreadyOnList.join(", ") }));
    }
  };

  const handleScanned = async (barcode: string) => {
    const found = await findItemByBarcodeAction(barcode);
    if (found.kind === "error") {
      toast.error(found.error);
      return;
    }
    if (found.kind === "unknown") {
      if (found.name) setValue(found.name);
      toast.info(found.name ? dict.scanUnknown : dict.scanUnknownNoName);
      inputRef.current?.focus();
      return;
    }
    const { item } = found;
    const result = await smartAddShoppingListItemsAction(listId, [
      { name: item.name, quantity: 1, unit: item.unit, inventoryItemId: item.id },
    ]);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if ((result.addedIds ?? []).length > 0) toast.success(format(dict.scanAddedToast, { name: item.name }));
    reportAdded(result);
  };

  const pick = (suggestion: SmartAddCandidate) => commit(rowsForSuggestion(value, suggestion));

  // Handled on keydown rather than via a <form onSubmit>, for the same
  // base-ui Field.Control reason QuickAddBar gives.
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter that confirms an IME composition (e.g. a Japanese keyboard)
    // isn't a submit.
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (suggestions.length === 0) return;
        e.preventDefault();
        setDismissed(false);
        // Cycles through the suggestions and back to "none" (-1), where
        // Enter adds the typed text as-is.
        const step = e.key === "ArrowDown" ? 1 : -1;
        const positions = suggestions.length + 1;
        setActiveIndex((index) => ((index + 1 + step + positions) % positions) - 1);
        break;
      }
      case "Escape":
        if (!open) return;
        e.preventDefault();
        setDismissed(true);
        setActiveIndex(-1);
        break;
      case "Enter":
        e.preventDefault();
        if (activeSuggestion) pick(activeSuggestion);
        else commit(parseSmartAddInput(value));
        break;
    }
  };

  return (
    // Sticky on phones, where the list scrolls under it, so the add line is
    // always one tap away — same treatment as the inventory search bar.
    <div className="flex flex-col gap-1.5 max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:-mx-4 max-sm:bg-background max-sm:px-4 max-sm:pt-1 max-sm:pb-2">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Input
            ref={inputRef}
            role="combobox"
            aria-label={dict.inputLabel}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeSuggestion ? `${listboxId}-${activeIndex}` : undefined}
            autoComplete="off"
            enterKeyHint="enter"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setActiveIndex(-1);
              setDismissed(false);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={dict.placeholder}
            maxLength={1000}
          />
          {open && (
            <ul
              id={listboxId}
              role="listbox"
              aria-label={dict.suggestionsLabel}
              className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  // Keeps focus (and the on-screen keyboard) in the input
                  // when a suggestion is tapped.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => pick(suggestion)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm",
                    index === activeIndex && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="min-w-0 truncate">{suggestion.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {suggestion.stockStatus !== "in" && (
                      <Badge variant={suggestion.stockStatus === "out" ? "destructive" : "warning"}>
                        {suggestion.stockStatus === "out" ? dict.stockOut : dict.stockLow}
                      </Badge>
                    )}
                    {suggestion.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <BarcodeScannerButton
          dict={barcodeDict}
          size="icon"
          label={dict.scanLabel}
          onDetected={handleScanned}
        />
        <Button
          type="button"
          size="icon"
          disabled={!value.trim()}
          aria-label={dict.add}
          onClick={() => commit(parseSmartAddInput(value))}
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground max-sm:hidden">{dict.hint}</p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
