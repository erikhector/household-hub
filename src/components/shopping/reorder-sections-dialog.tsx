"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogHandle,
} from "@/components/ui/dialog";
import { saveCategoryOrderAction } from "@/app/dashboard/shopping-list/actions";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type ReorderSection = { key: string; label: string };

/**
 * AUTO-9's "Reorder sections", opened from the list's ⋯ menu: the sections
 * this list actually has, in their current walk order, each with up/down
 * buttons. Buttons rather than drag and drop on purpose — no extra
 * dependency, they work the same with a thumb on a phone in a store aisle
 * as with a keyboard, and a list rarely has more than a handful of
 * sections to shuffle. Nothing is saved until "Save order";
 * saveCategoryOrderAction merges these sections into the household's whole
 * order, so sections this list doesn't have keep their place.
 */
export function ReorderSectionsDialog({
  sections,
  dict,
  handle,
}: {
  /** In current walk order; "Other" is left out, it always sorts last. */
  sections: ReorderSection[];
  dict: Dictionary["shoppingList"]["reorderSections"];
  handle: DialogHandle;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(sections);
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // Start from the order the list shows right now, every time it opens,
    // rather than a stale draft from a previous open.
    if (next) setDraft(sections);
  };

  const move = (index: number, delta: -1 | 1) =>
    setDraft((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = () =>
    startTransition(async () => {
      const result = await saveCategoryOrderAction(draft.map((section) => section.key));
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(dict.savedToast);
      setOpen(false);
    });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{dict.title}</DialogTitle>
          <DialogDescription>{dict.description}</DialogDescription>
        </DialogHeader>
        <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {draft.map((section, index) => (
            <li key={section.key} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <span className="flex-1 truncate text-sm">{section.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={index === 0 || isPending}
                aria-label={format(dict.moveUp, { name: section.label })}
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={index === draft.length - 1 || isPending}
                aria-label={format(dict.moveDown, { name: section.label })}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </Button>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setOpen(false)}>
            {dict.cancel}
          </Button>
          <Button type="button" disabled={isPending} onClick={save}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {dict.saving}
              </>
            ) : (
              dict.save
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
