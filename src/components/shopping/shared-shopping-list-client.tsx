"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { toggleItemViaShareTokenAction } from "@/app/share/shopping-list/actions";
import { Checkbox } from "@/components/ui/checkbox";
import type { SharedShoppingList } from "@/app/share/shopping-list/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

/**
 * Client half of the public, unauthenticated share page
 * (src/app/share/shopping-list/[token]/page.tsx) — the token is the only
 * credential (see that page and src/app/share/shopping-list/actions.ts), so
 * unlike ShoppingListClient there's no session/household context to thread
 * through, no add/delete/complete controls, and no "editable" gating: any
 * visitor holding the link can check off any item, by product decision.
 *
 * Keeps its own optimistic-ish local `items` state (seeded from the server
 * fetch, patched in place after each toggle) since there's no revalidated
 * server component wrapping this in a session-scoped layout to re-render it
 * automatically the way the dashboard's revalidatePath calls do.
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
  const [isPending, startTransition] = useTransition();

  function handleToggle(itemId: string) {
    startTransition(async () => {
      const result = await toggleItemViaShareTokenAction(token, itemId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, purchased: !item.purchased } : item)),
      );
    });
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
            <SharedRow key={item.id} item={item} isPending={isPending} onToggle={handleToggle} />
          ))}
          {purchasedItems.length > 0 && (
            <p className="mt-4 text-xs font-medium uppercase text-muted-foreground">
              {dict.purchased}
            </p>
          )}
          {purchasedItems.map((item) => (
            <SharedRow key={item.id} item={item} isPending={isPending} onToggle={handleToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

function SharedRow({
  item,
  isPending,
  onToggle,
}: {
  item: SharedShoppingList["items"][number];
  isPending: boolean;
  onToggle: (itemId: string) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-md border px-3 py-2 max-sm:min-h-11">
      <Checkbox
        checked={item.purchased}
        disabled={isPending}
        onChange={() => onToggle(item.id)}
      />
      {/* GAP-5: name line plus the note (when set) as a muted second line,
          same treatment as ShoppingListClient's rows. */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate ${item.purchased ? "text-muted-foreground line-through" : ""}`}
          title={`${item.name} × ${item.quantity} ${item.unit}`}
        >
          {item.name} × {item.quantity} {item.unit}
        </span>
        {item.note && (
          <span className="text-xs break-words whitespace-pre-line text-muted-foreground">{item.note}</span>
        )}
      </span>
    </label>
  );
}
