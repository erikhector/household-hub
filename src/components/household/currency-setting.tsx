"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import { Coins } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setHouseholdCurrencyAction } from "@/lib/actions/household";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

// Base UI's Select has no "nothing selected" item of its own, and an empty
// string reads as "no value" to it, so "no currency" gets a sentinel that
// can't collide with an ISO 4217 code (those are three upper-case letters).
const NONE = "none";

// GAP-13's Household page card. Saves on change (a click action, like
// AutoAddSetting) and shows the new value straight away via useOptimistic,
// which snaps back by itself if the save fails. Everyone sees the current
// value; only the owner can change it (setHouseholdCurrencyAction enforces
// that server-side too). The no-conversion hint is always visible because
// the obvious misreading — "switching to EUR converts my kronor" — is the
// one thing this setting must not be mistaken for.
export function CurrencySetting({
  currencyCode,
  isOwner,
  locale,
  dict,
}: {
  currencyCode: string | null;
  isOwner: boolean;
  locale: Locale;
  dict: Dictionary["household"]["currency"];
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticValue, setOptimisticValue] = useOptimistic(currencyCode ?? NONE);

  // Currency names in the viewer's own language ("Swedish krona" /
  // "svensk krona") without a dictionary entry per currency.
  const labels = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "currency" });
    const map = new Map<string, string>([[NONE, dict.none]]);
    for (const code of SUPPORTED_CURRENCIES) {
      map.set(code, format(dict.option, { name: names.of(code) ?? code, code }));
    }
    return map;
  }, [locale, dict]);

  function handleChange(next: string) {
    if (next === optimisticValue) return;
    startTransition(async () => {
      setOptimisticValue(next);
      const result = await setHouseholdCurrencyAction(next === NONE ? null : next);
      if (result.error) toast.error(result.error);
      else toast.success(dict.savedToast);
    });
  }

  return (
    <div className="list-bleed flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
          <Coins className="size-4 shrink-0" />
          {dict.title}
        </h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="household-currency">{dict.label}</Label>
        <Select
          value={optimisticValue}
          onValueChange={(v) => handleChange(String(v))}
          disabled={!isOwner || isPending}
        >
          <SelectTrigger id="household-currency" className="w-full sm:w-72">
            <SelectValue>{(v: string) => labels.get(v) ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[NONE, ...SUPPORTED_CURRENCIES].map((code) => (
              <SelectItem key={code} value={code}>
                {labels.get(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isOwner && <p className="text-sm text-muted-foreground">{dict.ownerOnlyHint}</p>}
      </div>
      <p className="text-sm text-muted-foreground">{dict.noConversionHint}</p>
    </div>
  );
}
