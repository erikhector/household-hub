"use client";

import { formatShoppingItemLabel } from "@/lib/shopping-list-text";
import { useUnitLabel } from "@/components/units-provider";
import type { ShoppingModeGroup } from "@/lib/shopping/shopping-mode-grouping";
import type { ShoppingListDict, ShoppingListItemRow } from "@/components/shopping/shopping-list-types";

/**
 * GAP-24's paper copy: what's still left to buy, grouped under the same
 * category headers as shopping mode (AUTO-3's groupPendingItemsByCategory,
 * so aisle order matches the screen), in big black-on-white single-column
 * text for a fridge door or a trolley handle. `hidden print:block`: it
 * never shows on screen, and the column above hides everything else on
 * paper. Purchased items, prices, badges and the estimated total are left
 * out on purpose. They're for the phone, and on paper they'd just be noise
 * between the things you still need. Each row gets an empty box to tick
 * with a pen, and break-inside-avoid keeps a category header from being
 * stranded at the bottom of a page without its items.
 */
export function PrintableList({
  name,
  groups,
  dict,
}: {
  name: string;
  groups: ShoppingModeGroup<ShoppingListItemRow>[];
  dict: ShoppingListDict;
}) {
  const unitLabel = useUnitLabel();
  return (
    <section data-print-list className="hidden bg-white text-black print:block">
      <h1 className="mb-6 border-b-2 border-black pb-2 font-heading text-4xl font-bold">{name}</h1>
      {groups.length === 0 ? (
        <p className="text-2xl">{dict.printEmpty}</p>
      ) : (
        groups.map((group) => (
          <div key={group.key ?? ""} className="mb-6 break-inside-avoid">
            <h2 className="mb-2 text-lg font-bold uppercase tracking-wide">{group.label}</h2>
            <ul className="flex flex-col gap-2">
              {group.items.map((item) => (
                <li key={item.id} className="flex items-baseline gap-3 text-2xl leading-snug">
                  <span aria-hidden className="inline-block size-5 shrink-0 translate-y-0.5 border-2 border-black" />
                  <span>
                    {formatShoppingItemLabel(item, unitLabel)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
