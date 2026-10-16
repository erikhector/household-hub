"use client";

import { useOptimistic, useTransition } from "react";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setInventorySyncModeAction } from "@/lib/actions/household";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type Mode = "ON_CHECK" | "ON_PUT_AWAY";

// Household.inventorySyncMode's card on the Household page: whether a tick
// on a shopping list updates inventory straight away or waits for the
// list's "Put away" step. Saves on change with useOptimistic, like
// CurrencySetting, and is owner-only the same way (setInventorySyncModeAction
// enforces it server-side too); everyone sees the current choice. The hint
// under the select explains the chosen mode rather than both, since the
// difference only matters once you know which one you're in.
export function InventorySyncSetting({
  mode,
  isOwner,
  dict,
}: {
  mode: Mode;
  isOwner: boolean;
  dict: Dictionary["household"]["inventorySync"];
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticMode, setOptimisticMode] = useOptimistic<Mode>(mode);
  const labels: Record<Mode, string> = { ON_CHECK: dict.onCheck, ON_PUT_AWAY: dict.onPutAway };

  function handleChange(next: Mode) {
    if (next === optimisticMode) return;
    startTransition(async () => {
      setOptimisticMode(next);
      const result = await setInventorySyncModeAction(next);
      if (result.error) toast.error(result.error);
      else toast.success(dict.savedToast);
    });
  }

  return (
    <div className="list-bleed flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
          <PackageCheck className="size-4 shrink-0" />
          {dict.title}
        </h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="household-inventory-sync">{dict.label}</Label>
        <Select
          value={optimisticMode}
          onValueChange={(v) => handleChange(v as Mode)}
          disabled={!isOwner || isPending}
        >
          <SelectTrigger id="household-inventory-sync" className="w-full sm:w-72">
            <SelectValue>{(v: Mode) => labels[v] ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(["ON_PUT_AWAY", "ON_CHECK"] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {labels[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isOwner && <p className="text-sm text-muted-foreground">{dict.ownerOnlyHint}</p>}
      </div>
      <p className="text-sm text-muted-foreground">
        {optimisticMode === "ON_PUT_AWAY" ? dict.onPutAwayHint : dict.onCheckHint}
      </p>
    </div>
  );
}
