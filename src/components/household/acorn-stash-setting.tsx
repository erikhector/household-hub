"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { setAcornStashEnabledAction } from "@/lib/actions/household";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// Household.acornStashEnabled's card on the Household page: the opt-in for
// the acorn stash on the Tasks page. Same shape as AutoAddSetting: a click
// action whose box flips at once via useOptimistic and snaps back on its own
// if the save fails, with a toast either way.
export function AcornStashSetting({
  enabled,
  dict,
}: {
  enabled: boolean;
  dict: Dictionary["household"]["acornStash"];
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleChange(next: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(next);
      const result = await setAcornStashEnabledAction(next);
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
          <span className="text-sm font-medium">{dict.label}</span>
          <span className="text-sm text-muted-foreground">{dict.description}</span>
        </span>
      </label>
    </div>
  );
}
