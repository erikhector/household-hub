"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { toggleItemViaShareTokenAction } from "@/app/share/shopping-list/actions";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { BrandBadge } from "@/components/brand/brand-badge";
import { SharedListView, SharedRowView } from "@/components/shopping/shared-list-view";
import type { SharedShoppingList } from "@/app/share/shopping-list/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";

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
 * the member view. The list itself is SharedListView, which the landing
 * page's product shot renders too, with example rows.
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

  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/"
        className="flex min-h-11 items-center gap-2 self-start font-heading text-lg font-bold tracking-tight"
      >
        <BrandBadge className="size-8" />
        {brand}
      </Link>
      <SharedListView
        name={list.name}
        sharedBy={format(dict.sharedBy, { household: list.householdName })}
        items={items}
        storeOrder={list.storeOrder}
        otherCategory={otherCategory}
        locale={locale}
        dict={dict}
        shoppingMode={shoppingMode}
        renderRow={(item) => (
          <SharedRow key={item.id} token={token} item={item} saveFailed={dict.saveFailedToast} onToggled={handleToggled} />
        )}
      >
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>{dict.liveNotice}</p>
        </div>
      </SharedListView>

      {/* The footer note existed in the dictionary but was never shown. */}
      <p className="mt-3 text-center text-xs text-muted-foreground">
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
  const [, startTransition] = useTransition();
  const [purchased, toggleOptimisticPurchased] = useOptimistic<boolean, void>(item.purchased, (current) => !current);

  function handleToggle() {
    startTransition(async () => {
      toggleOptimisticPurchased();
      const result = await settleOptimisticAction(() => toggleItemViaShareTokenAction(token, item.id), saveFailed);
      if (result) onToggled(item.id);
    });
  }

  return <SharedRowView item={item} purchased={purchased} onToggle={handleToggle} />;
}
