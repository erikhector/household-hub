"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { formatShoppingItemLabel } from "@/lib/shopping-list-text";
import { Check, Info } from "lucide-react";
import { toggleItemViaShareTokenAction } from "@/app/share/shopping-list/actions";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { BrandBadge } from "@/components/brand/brand-badge";
import { ProgressRing } from "@/components/shopping/shopping-mode";
import { Checkbox } from "@/components/ui/checkbox";
import type { SharedShoppingList } from "@/app/share/shopping-list/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import { groupPendingItemsByCategory } from "@/lib/shopping/shopping-mode-grouping";
import { shoppingProgress } from "@/lib/shopping/shopping-progress";
import { useUnitLabel } from "@/components/units-provider";

/**
 * Client half of the public, unauthenticated share page
 * (src/app/share/shopping-list/[token]/page.tsx) — the token is the only
 * credential (see that page and src/app/share/shopping-list/actions.ts), so
 * unlike ShoppingListClient there's no session/household context to thread
 * through, no add/delete/complete controls, and no "editable" gating: any
 * visitor holding the link can check off any item, by product decision.
 *
 * Keeps its own local `items` state (seeded from the server fetch, patched
 * in place after each saved toggle) since there's no revalidated server
 * component wrapping this in a session-scoped layout to re-render it
 * automatically the way the dashboard's revalidatePath calls do. On top of
 * that each row ticks optimistically in its own transition (UX-14, see
 * SharedRow), the same as the dashboard's ShoppingRow.
 *
 * UX-63: the person you share with is often the one in the shop, so the page
 * gives them the member view's shopping aids: the brand and who shared it,
 * pending rows grouped by aisle in the household's store order, an "n of m"
 * progress ring and an All done state. There is no dock: the list is read
 * and ticked in place, and the dock's job (reaching the thumb) belongs to
 * the member view.
 */
export function SharedShoppingListClient({
  token,
  list,
  dict,
  shoppingMode,
  otherCategory,
  brand,
  locale,
}: {
  token: string;
  list: SharedShoppingList;
  dict: Dictionary["sharedShoppingList"];
  /** The ring's labels, shared with the member view. */
  shoppingMode: Dictionary["shoppingList"]["shoppingMode"];
  otherCategory: string;
  brand: string;
  locale: Locale;
}) {
  const [items, setItems] = useState(list.items);

  // Called inside the row's transition once its toggle has saved, so the
  // row's optimistic value hands over to this one without a flicker.
  function handleToggled(itemId: string) {
    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, purchased: !item.purchased } : item)),
    );
  }

  const pendingItems = items.filter((item) => !item.purchased);
  const purchasedItems = items.filter((item) => item.purchased);
  const groups = groupPendingItemsByCategory(pendingItems, otherCategory, list.storeOrder, locale);
  const progress = shoppingProgress(items);
  const allDone = items.length > 0 && pendingItems.length === 0;
  const renderRow = (item: SharedShoppingList["items"][number]) => (
    <SharedRow key={item.id} token={token} item={item} saveFailed={dict.saveFailedToast} onToggled={handleToggled} />
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 self-start font-heading text-lg font-bold tracking-tight"
        >
          <BrandBadge className="size-8" />
          {brand}
        </Link>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight break-words">{list.name}</h1>
            <p className="text-sm break-words text-muted-foreground">
              {format(dict.sharedBy, { household: list.householdName })}
            </p>
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
      </header>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>{dict.liveNotice}</p>
      </div>

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
              <h2 className="mt-2 text-xs font-medium uppercase text-muted-foreground">{group.label}</h2>
              {group.items.map(renderRow)}
            </section>
          ))}
          {purchasedItems.length > 0 && (
            <>
              <h2 className="mt-4 text-xs font-medium uppercase text-muted-foreground">{dict.purchased}</h2>
              {purchasedItems.map(renderRow)}
            </>
          )}
        </div>
      )}

      {/* The footer note existed in the dictionary but was never shown. */}
      <p className="text-center text-xs text-muted-foreground">
        {dict.footerNote}{" "}
        <Link
          href="/"
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
        >
          {dict.footerLink}
        </Link>
      </p>
    </div>
  );
}

// UX-14: same optimistic tick as the dashboard's ShoppingRow — flips at once
// in its own transition, so ticking several rows in a row never waits on (or
// greys out behind) an earlier save, and snaps back with a toast if the save
// fails or the rate limit says no.
function SharedRow({
  token,
  item,
  saveFailed,
  onToggled,
}: {
  token: string;
  item: SharedShoppingList["items"][number];
  saveFailed: string;
  onToggled: (itemId: string) => void;
}) {
  const unitLabel = useUnitLabel();
  const [, startTransition] = useTransition();
  const [purchased, toggleOptimisticPurchased] = useOptimistic<boolean, void>(item.purchased, (current) => !current);

  function handleToggle() {
    startTransition(async () => {
      toggleOptimisticPurchased();
      const result = await settleOptimisticAction(() => toggleItemViaShareTokenAction(token, item.id), saveFailed);
      if (result) onToggled(item.id);
    });
  }

  return (
    <label className="flex items-center gap-3 rounded-md border px-3 py-2 max-sm:min-h-11 pointer-coarse:min-h-11">
      <Checkbox checked={purchased} onChange={handleToggle} />
      {/* GAP-5: name line plus the note (when set) as a muted second line,
          same treatment as ShoppingListClient's rows. UX-63: the name wraps
          in full — a clamped one was readable only in a title tooltip, which
          a phone can't show. */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`break-words ${purchased ? "text-muted-foreground line-through" : ""}`}>
          {formatShoppingItemLabel(item, unitLabel)}
        </span>
        {item.note && (
          <span className="text-xs break-words whitespace-pre-line text-muted-foreground">{item.note}</span>
        )}
      </span>
    </label>
  );
}
