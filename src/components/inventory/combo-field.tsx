"use client";

import { useRef, useState } from "react";
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteTrigger,
} from "@/components/ui/autocomplete";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type ComboFieldDict = Pick<
  Dictionary["inventory"],
  "comboboxNoMatches" | "comboboxAddNew" | "comboboxClear" | "comboboxShowSuggestions"
>;

/**
 * A free-text field with autocomplete suggestions drawn from existing values
 * (category/location/unit) — shared by the single-item add/edit dialog and
 * every bulk-add surface (scan queue, pasted-list review, quick-add grid) so
 * they all pick from the same values instead of drifting into near-duplicate
 * categories like "Fridge" vs. "fridge". `dict` only needs the two combobox
 * copy strings, not the whole inventory dictionary, so the shopping list's
 * item-edit surfaces (which carry their own copy of those two strings) can
 * reuse this component for its unit field too.
 *
 * `onEnter` is for fields inside a longer form (the recipe's ingredient rows):
 * Enter with no suggestion highlighted would otherwise fall through to the
 * form and submit it half-filled (UX-93), so when it is given, Enter is
 * swallowed and handed to the caller to move on. Enter on a highlighted
 * suggestion still picks it. Without `onEnter` nothing changes, so the
 * inventory dialogs keep their Enter-submits behaviour.
 */
export function ComboField({
  id,
  name,
  items,
  value,
  onValueChange,
  placeholder,
  maxLength,
  ariaLabel,
  label,
  dict,
  onEnter,
  browseOnTap,
}: {
  id: string;
  /** Omit when the value is read from state rather than posted with a
   * surrounding form. */
  name?: string;
  items: string[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  maxLength: number;
  /** For a field with no visible <Label htmlFor={id}> (the item page's
   * "Try it" sentence), so it still has a name for screen readers. */
  ariaLabel?: string;
  /** The field's visible name ("Unit", "Category"), lower-cased into the
   * clear button's name the clear button "Clear unit" so a screen reader doesn't
   * announce two bare "button"s per field (UX-129). */
  label: string;
  dict: ComboFieldDict;
  /** Called when Enter is pressed with no suggestion highlighted, and after
   * the `Use "X"` row is tapped. Also stops that Enter from submitting the
   * surrounding form. */
  onEnter?: () => void;
  /** UX-127, for the unit fields: tapping the field itself opens the whole
   * list, so the other units are one tap away even while it holds "pcs".
   * Off for category/location, whose long lists would cover the next field. */
  browseOnTap?: boolean;
}) {
  const trimmed = value.trim();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // UX-127: a field that already holds a value ("pcs") would filter the list
  // down to that one value, so seeing the other units meant erasing it first.
  // While the popup was opened by a tap (field or chevron) rather than by
  // typing, show every suggestion; typing filters again.
  const [browsing, setBrowsing] = useState(false);
  const browse = () => {
    setBrowsing(true);
    setOpen(true);
  };
  return (
    <Autocomplete
      items={items}
      name={name}
      value={value}
      filter={browsing ? null : undefined}
      onValueChange={(next, details) => {
        if (details.reason === "input-change") setBrowsing(false);
        onValueChange(next);
      }}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setBrowsing(false);
      }}
    >
      <AutocompleteInputGroup>
        <AutocompleteInput
          ref={inputRef}
          id={id}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-label={ariaLabel}
          onClick={browseOnTap ? browse : undefined}
          onKeyDown={
            onEnter
              ? (event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  // A highlighted suggestion is the popup's to pick.
                  if (event.currentTarget.getAttribute("aria-activedescendant")) return;
                  event.preventDefault();
                  setOpen(false);
                  onEnter();
                }
              : undefined
          }
        />
        <AutocompleteClear
          aria-label={format(dict.comboboxClear, { field: label.toLocaleLowerCase() })}
        />
        <AutocompleteTrigger aria-label={dict.comboboxShowSuggestions} onClick={() => setBrowsing(true)} />
      </AutocompleteInputGroup>
      <AutocompleteContent>
        <AutocompleteEmpty>
          {trimmed ? (
            // The typed text is already the value; this row only has to
            // look and act like it: tapping accepts it and closes the popup.
            <button
              type="button"
              className="flex min-h-9 w-full items-center rounded-md px-2 text-left max-sm:min-h-11 pointer-coarse:min-h-11"
              onClick={() => {
                setOpen(false);
                if (onEnter) onEnter();
                else inputRef.current?.focus();
              }}
            >
              {format(dict.comboboxAddNew, { value: trimmed })}
            </button>
          ) : (
            dict.comboboxNoMatches
          )}
        </AutocompleteEmpty>
        <AutocompleteList>
          {(option: string) => (
            <AutocompleteItem key={option} value={option}>
              {option}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompleteContent>
    </Autocomplete>
  );
}
