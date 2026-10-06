"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Info } from "lucide-react";
import { toggleItemViaShareTokenAction } from "@/app/share/shopping-list/actions";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { Checkbox } from "@/components/ui/checkbox";
import type { SharedShoppingList } from "@/app/share/shopping-list/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
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
 */
export function SharedShoppingListClient({
  token,
  list,
  dict,
}: {
  token: string;
  list: SharedShoppingList;
  dict: Dictionary["sharedShoppingList"];
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight break-words">{list.name}</h1>

      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>{dict.liveNotice}</p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {dict.emptyList}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {pendingItems.map((item) => (
            <SharedRow key={item.id} token={token} item={item} saveFailed={dict.saveFailedToast} onToggled={handleToggled} />
          ))}
          {purchasedItems.length > 0 && (
            <p className="mt-4 text-xs font-medium uppercase text-muted-foreground">
              {dict.purchased}
            </p>
          )}
          {purchasedItems.map((item) => (
            <SharedRow key={item.id} token={token} item={item} saveFailed={dict.saveFailedToast} onToggled={handleToggled} />
          ))}
        </div>
      )}
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
    <label className="flex items-center gap-3 rounded-md border px-3 py-2 max-sm:min-h-11">
      <Checkbox checked={purchased} onChange={handleToggle} />
      {/* GAP-5: name line plus the note (when set) as a muted second line,
          same treatment as ShoppingListClient's rows. */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate ${purchased ? "text-muted-foreground line-through" : ""}`}
          title={`${item.name} × ${item.quantity} ${unitLabel(item.unit)}`}
        >
          {item.name} × {item.quantity} {unitLabel(item.unit)}
        </span>
        {item.note && (
          <span className="text-xs break-words whitespace-pre-line text-muted-foreground">{item.note}</span>
        )}
      </span>
    </label>
  );
}
