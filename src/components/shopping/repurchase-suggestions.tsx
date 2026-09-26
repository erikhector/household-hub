"use client";

// "You usually buy this about now" chips (AUTO-10), shown above an ACTIVE
// list. The suggestions are computed on the server from the household's
// purchase rhythm (src/lib/inventory/repurchase-suggestions.ts); this only
// renders them. One tap adds the item to this list; the × snoozes it until
// its next cycle. Both go through Server Actions — unlike UseItUpSuggestions'
// localStorage dismissals, a snooze here is household data (it's about the
// household's shopping, not one person's screen), so it holds on every
// member's device and nothing new is stored in the browser.
//
// Chips hide optimistically on tap, then the action's revalidatePath brings
// the real list; a failed action puts the chip back.

import { useState, useTransition } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import {
  addRepurchaseSuggestionAction,
  dismissRepurchaseSuggestionAction,
  undoDismissRepurchaseSuggestionAction,
} from "@/app/dashboard/shopping-list/repurchase-actions";

export type RepurchaseSuggestionData = {
  inventoryItemId: string;
  name: string;
  intervalDays: number;
};

export function RepurchaseSuggestions({
  listId,
  suggestions,
  dict,
}: {
  listId: string;
  suggestions: RepurchaseSuggestionData[];
  dict: Dictionary["repurchase"];
}) {
  const [isPending, startTransition] = useTransition();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const setVisible = (id: string, visible: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleSuggestions = suggestions.filter((suggestion) => !hidden.has(suggestion.inventoryItemId));
  if (visibleSuggestions.length === 0) return null;

  const add = (suggestion: RepurchaseSuggestionData) => {
    setVisible(suggestion.inventoryItemId, false);
    startTransition(async () => {
      const result = await addRepurchaseSuggestionAction(listId, suggestion.inventoryItemId);
      if (result.error) {
        setVisible(suggestion.inventoryItemId, true);
        toast.error(result.error);
        return;
      }
      toast.success(format(dict.added, { name: suggestion.name }));
    });
  };

  const dismiss = (suggestion: RepurchaseSuggestionData) => {
    setVisible(suggestion.inventoryItemId, false);
    startTransition(async () => {
      const result = await dismissRepurchaseSuggestionAction(suggestion.inventoryItemId);
      if (result.error) {
        setVisible(suggestion.inventoryItemId, true);
        toast.error(result.error);
        return;
      }
      toast.success(format(dict.dismissed, { name: suggestion.name }), {
        action: {
          label: dict.undo,
          onClick: () =>
            startTransition(async () => {
              const undo = await undoDismissRepurchaseSuggestionAction(suggestion.inventoryItemId);
              if (undo.error) {
                toast.error(undo.error);
                return;
              }
              setVisible(suggestion.inventoryItemId, true);
            }),
        },
      });
    });
  };

  return (
    <div className="flex flex-col gap-2 print:hidden">
      <p className="text-sm text-muted-foreground">{dict.label}</p>
      <div className="flex flex-wrap gap-2">
        {visibleSuggestions.map((suggestion) => {
          const label = format(plural(suggestion.intervalDays, dict.chip), {
            name: suggestion.name,
            count: suggestion.intervalDays,
          });
          return (
            <div
              key={suggestion.inventoryItemId}
              className="flex items-center gap-0.5 rounded-full border border-dashed text-sm"
            >
              <button
                type="button"
                disabled={isPending}
                onClick={() => add(suggestion)}
                aria-label={format(dict.addAriaLabel, { name: suggestion.name })}
                className="flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1 hover:text-primary disabled:opacity-60"
              >
                <RefreshCw className="size-3.5 shrink-0 text-primary" />
                <span>{label}</span>
                <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isPending}
                className="mr-1 size-5 shrink-0 text-muted-foreground"
                aria-label={format(dict.dismissAriaLabel, { name: suggestion.name })}
                onClick={() => dismiss(suggestion)}
              >
                <X className="size-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
