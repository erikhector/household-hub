"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { ProgressRing } from "@/components/shopping/shopping-mode";
import { Checkbox } from "@/components/ui/checkbox";
import { formatShoppingItemLabel } from "@/lib/shopping-list-text";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import { groupPendingItemsByCategory } from "@/lib/shopping/shopping-mode-grouping";
import { shoppingProgress } from "@/lib/shopping/shopping-progress";
import type { StoreOrder } from "@/lib/shopping/store-order";
import { useUnitLabel } from "@/components/units-provider";
import { cn } from "@/lib/utils";

export type SharedListViewItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  purchased: boolean;
  note: string | null;
  category: string | null;
};

export type SharedListViewDict = Pick<
  Dictionary["sharedShoppingList"],
  "purchased" | "emptyList" | "allDoneTitle" | "allDoneDescription"
>;

/**
 * The share page's list, as it looks: the list name with who shared it and
 * the "n of m" progress ring, then the pending rows grouped by aisle in the
 * household's store order, the "In the cart" rows, and the All done card
 * (UX-63). It has no state and no save of its own: `renderRow` draws each
 * row, so SharedShoppingListClient binds the rows to the share-token toggle
 * and the landing page's PhonePreview shows the same list with example rows
 * and no save at all. The two render the same markup, which is the point:
 * the landing page's product shot is the product, and can't drift from it.
 *
 * `decorative` is for the landing page: the view then draws its title and
 * aisle labels as plain text rather than headings, since it sits inside an
 * inert `role="img"` and the page already has its own h1.
 */
export function SharedListView({
  name,
  sharedBy,
  items,
  storeOrder,
  otherCategory,
  locale,
  dict,
  shoppingMode,
  renderRow,
  decorative = false,
  children,
}: {
  name: string;
  sharedBy: string;
  items: readonly SharedListViewItem[];
  storeOrder?: StoreOrder;
  otherCategory: string;
  locale: Locale;
  dict: SharedListViewDict;
  /** The ring's labels, shared with the member view. */
  shoppingMode: Dictionary["shoppingList"]["shoppingMode"];
  renderRow: (item: SharedListViewItem) => ReactNode;
  decorative?: boolean;
  /** Drawn between the header and the rows (the share page's live notice). */
  children?: ReactNode;
}) {
  const Title = decorative ? "p" : "h1";
  const Aisle = decorative ? "p" : "h2";
  const pendingItems = items.filter((item) => !item.purchased);
  const purchasedItems = items.filter((item) => item.purchased);
  const groups = groupPendingItemsByCategory(pendingItems, otherCategory, storeOrder, locale);
  const progress = shoppingProgress(items);
  const allDone = items.length > 0 && pendingItems.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Title className="font-heading text-2xl font-semibold tracking-tight break-words">{name}</Title>
          <p className="text-sm break-words text-muted-foreground">{sharedBy}</p>
        </div>
        {items.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <ProgressRing progress={progress} dict={shoppingMode} />
            {/* The progressbar already says this to a screen reader. */}
            <span aria-hidden className="text-sm font-semibold tabular-nums">
              {format(shoppingMode.progress, { done: progress.done, total: progress.total })}
            </span>
          </div>
        )}
      </div>

      {children}

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {dict.emptyList}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {allDone && (
            <div className="flex flex-col items-center gap-1.5 rounded-xl bg-card p-6 text-center ring-1 ring-foreground/10">
              <Check aria-hidden className="size-8 text-primary" />
              <p className="font-heading text-xl font-semibold">{dict.allDoneTitle}</p>
              <p className="text-sm text-muted-foreground">{dict.allDoneDescription}</p>
            </div>
          )}
          {groups.map((group) => (
            <section key={group.key ?? "other"} className="flex flex-col gap-2">
              <Aisle className="mt-2 text-xs font-medium uppercase text-muted-foreground">{group.label}</Aisle>
              {group.items.map(renderRow)}
            </section>
          ))}
          {purchasedItems.length > 0 && (
            <>
              <Aisle className="mt-4 text-xs font-medium uppercase text-muted-foreground">{dict.purchased}</Aisle>
              {purchasedItems.map(renderRow)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One row of the share page's list: the tick box and the item's label (GAP-5:
 * the note as a muted second line; UX-63: the name wraps in full, since a
 * clamped one was readable only in a title tooltip, which a phone can't
 * show). `purchased` is the value to draw, so a caller can show an
 * optimistic tick ahead of its save; `ticking` plays the checkbox's
 * tick-pop (UX-54) when the tick wasn't the viewer's own tap.
 */
export function SharedRowView({
  item,
  purchased,
  onToggle,
  ticking = false,
}: {
  item: Pick<SharedListViewItem, "name" | "quantity" | "unit" | "note">;
  purchased: boolean;
  onToggle: () => void;
  ticking?: boolean;
}) {
  const unitLabel = useUnitLabel();
  return (
    <label className="flex items-center gap-3 rounded-md border px-3 py-2 max-sm:min-h-11 pointer-coarse:min-h-11">
      <Checkbox checked={purchased} onChange={onToggle} data-ticking={ticking || undefined} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("break-words", purchased && "text-muted-foreground line-through")}>
          {formatShoppingItemLabel(item, unitLabel)}
        </span>
        {item.note && (
          <span className="text-xs break-words whitespace-pre-line text-muted-foreground">{item.note}</span>
        )}
      </span>
    </label>
  );
}
