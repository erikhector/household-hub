"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quickAddInventoryItemAction } from "@/app/dashboard/inventory/actions";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

/**
 * Name-only rapid entry: type, press Enter, repeat — no dialog round trip
 * and no category prompt (server files it under "Uncategorized"). Meant for
 * a household starting from zero items, where the full add-item dialog's
 * per-field cost adds up fast across a dozen+ items.
 */
export function QuickAddBar({ dict }: { dict: Dictionary["inventory"] }) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || isPending) return;

    startTransition(async () => {
      const result = await quickAddInventoryItemAction(trimmed);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(format(dict.quickAdd.addedToast, { name: result.name ?? trimmed }));
      setName("");
    });
  };

  // Submitting directly on keydown (rather than relying on native implicit
  // form submission) sidesteps base-ui's Field.Control, which intercepts
  // Enter on its own terms and doesn't reliably let it reach a plain
  // `<form onSubmit>` here.
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submit();
  };

  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={dict.quickAdd.placeholder}
          maxLength={120}
          disabled={isPending}
          autoFocus
        />
        <Button
          type="button"
          size="icon"
          disabled={isPending || !name.trim()}
          aria-label={dict.quickAdd.add}
          onClick={submit}
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {format(dict.quickAdd.hint, { category: dict.uncategorized })}
      </p>
    </div>
  );
}
