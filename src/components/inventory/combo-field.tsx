"use client";

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

/**
 * A free-text field with autocomplete suggestions drawn from existing values
 * (category/location/unit) — shared by the single-item add/edit dialog and
 * every bulk-add surface (scan queue, pasted-list review, quick-add grid) so
 * they all pick from the same values instead of drifting into near-duplicate
 * categories like "Fridge" vs. "fridge". `dict` only needs the two combobox
 * copy strings, not the whole inventory dictionary, so the shopping list's
 * item-edit surfaces (which carry their own copy of those two strings) can
 * reuse this component for its unit field too.
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
  dict,
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
  dict: Pick<Dictionary["inventory"], "comboboxNoMatches" | "comboboxAddNew">;
}) {
  const trimmed = value.trim();
  return (
    <Autocomplete items={items} name={name} value={value} onValueChange={onValueChange}>
      <AutocompleteInputGroup>
        <AutocompleteInput id={id} placeholder={placeholder} maxLength={maxLength} aria-label={ariaLabel} />
        <AutocompleteClear />
        <AutocompleteTrigger />
      </AutocompleteInputGroup>
      <AutocompleteContent>
        <AutocompleteEmpty>
          {trimmed ? format(dict.comboboxAddNew, { value: trimmed }) : dict.comboboxNoMatches}
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
