"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { setWeeklyDigestEnabledAction } from "@/lib/actions/digest";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// GAP-27's per-user opt-in for the weekly digest email. Same click-action +
// useOptimistic shape as AutoAddSetting (src/components/household/
// auto-add-setting.tsx): the box flips immediately and snaps back on its own
// if the save fails. Left toggleable while the address is unverified — the
// preference is remembered, and the cron only ever mails verified addresses
// (src/lib/weekly-digest.ts), so the note below explains why nothing arrives
// yet instead of hiding the switch.
export function WeeklyDigestSetting({
  enabled,
  emailVerified,
  dict,
}: {
  enabled: boolean;
  emailVerified: boolean;
  dict: Dictionary["profile"]["weeklyDigest"];
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

  function handleChange(next: boolean) {
    startTransition(async () => {
      setOptimisticEnabled(next);
      const result = await setWeeklyDigestEnabledAction(next);
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
          {optimisticEnabled && !emailVerified && (
            <span className="text-sm text-muted-foreground">{dict.unverified}</span>
          )}
        </span>
      </label>
    </div>
  );
}
