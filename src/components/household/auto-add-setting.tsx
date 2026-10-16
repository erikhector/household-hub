"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { setAutoAddLowStockToListAction } from "@/lib/actions/household";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// AUTO-8's household-wide on/off for the low-stock auto-add. A click action
// (not a form): the box flips immediately via useOptimistic and snaps back
// on its own if the save fails, since the optimistic value only lives for
// the length of the transition and the server-rendered `enabled` is the
// truth afterwards.
export function AutoAddSetting({
  enabled,
  dict,
}: {
  enabled: boolean;
  dict: Dictionary["household"]["shoppingSettings"];
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleChange(next: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(next);
      const result = await setAutoAddLowStockToListAction(next);
      if (result.error) toast.error(result.error);
      else toast.success(next ? dict.enabledToast : dict.disabledToast);
    });
  }

  return (
    <div className="list-bleed flex flex-col gap-3 rounded-md border p-4">
      <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox
          className="mt-0.5"
          checked={optimisticEnabled}
          disabled={isPending}
          onChange={(e) => handleChange(e.target.checked)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{dict.autoAddLabel}</span>
          <span className="text-sm text-muted-foreground">{dict.autoAddDescription}</span>
        </span>
      </label>
    </div>
  );
}
