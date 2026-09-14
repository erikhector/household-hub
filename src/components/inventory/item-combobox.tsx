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
}: {
  id?: string;
  items: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyMessage: string;
  ariaLabel?: string;
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
      <ComboboxInputGroup>
        <ComboboxInput id={id} placeholder={placeholder} aria-label={ariaLabel} />
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
