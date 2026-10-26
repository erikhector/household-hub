"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { setTonightsDinnerNudgeAction } from "@/lib/actions/notification-preferences";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// GAP-57's per-user opt-in for the morning "what's on the menu" nudge. Same
// click-action + useOptimistic shape as WeeklyDigestSetting: the box flips
// immediately and snaps back on its own if the save fails.
export function TonightsDinnerSetting({
  enabled,
  dict,
}: {
  enabled: boolean;
  dict: Dictionary["profile"]["tonightsDinner"];
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleChange(next: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(next);
      const result = await setTonightsDinnerNudgeAction(next);
      if (result.error) toast.error(result.error);
      else toast.success(next ? dict.enabledToast : dict.disabledToast);
    });
  }

  return (
    <div className="list-bleed flex flex-col gap-3 rounded-md border p-4">
      <h3 className="font-heading text-base font-semibold">{dict.title}</h3>
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
