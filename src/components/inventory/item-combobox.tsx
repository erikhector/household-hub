"use client";

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxTrigger,
  createComboboxItems,
} from "@/components/ui/combobox";

export type ComboboxOption = { id: string; label: string };

/**
 * A searchable picker for choosing exactly one of a known set of items by
 * id — the fixed-list counterpart to ComboField's free-text autocomplete.
 * Used wherever the shopping list flow needs to link to an existing
 * inventory item (or a shopping-list match target) out of a list that can
 * get long enough that scrolling a plain Select is worse than typing a few
 * letters to filter it.
 */
export function ItemCombobox({
  id,
  items,
  value,
  onValueChange,
  placeholder,
  emptyMessage,
  ariaLabel,
  invalid,
  describedBy,
}: {
  id?: string;
  items: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyMessage: string;
  ariaLabel?: string;
  /** Marks the input invalid for assistive tech (and styles the group). */
  invalid?: boolean;
  /** Id of the element that explains the value, e.g. its error message. */
  describedBy?: string;
}) {
  const comboboxItems = createComboboxItems(items, {
    getValue: (item) => item.id,
    getLabel: (item) => item.label,
  });

  return (
    <Combobox
      items={comboboxItems}
      value={value}
      onValueChange={(next) => onValueChange(typeof next === "string" ? next : "")}
    >
      <ComboboxInputGroup aria-invalid={invalid || undefined}>
        <ComboboxInput
          id={id}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
        <ComboboxTrigger aria-label={ariaLabel} />
      </ComboboxInputGroup>
      <ComboboxContent emptyMessage={emptyMessage}>
        {(item: ComboboxOption) => (
          <ComboboxItem key={item.id} value={item.id}>
            {item.label}
          </ComboboxItem>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
