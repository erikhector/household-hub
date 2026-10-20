"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setHouseholdCurrencyAction } from "@/lib/actions/household";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

// Same sentinel as CurrencySetting: Base UI's Select reads "" as no value.
const NONE = "none";

// UX-73: the currency a new household was given at signup (language or
// browser region, see defaultCurrencyForNewHousehold), shown on the budget's
// first-run card so a wrong guess is one tap to fix instead of a hunt for the
// Household page's sixth card. A compact sibling of CurrencySetting
// (src/components/household/currency-setting.tsx) and the same action, so
// the owner-only rule is still enforced server-side; everyone else, and the
// read-only view of another household, sees the value disabled.
export function OnboardingCurrency({
  currencyCode,
  canChange,
  locale,
  dict,
  currencyDict,
}: {
  currencyCode: string | null;
  canChange: boolean;
  locale: Locale;
  dict: Dictionary["budget"]["onboarding"];
  currencyDict: Dictionary["household"]["currency"];
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticValue, setOptimisticValue] = useOptimistic(currencyCode ?? NONE);

  const labels = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "currency" });
    const map = new Map<string, string>([[NONE, currencyDict.none]]);
    for (const code of SUPPORTED_CURRENCIES) {
      map.set(code, format(currencyDict.option, { name: names.of(code) ?? code, code }));
    }
    return map;
  }, [locale, currencyDict]);

  function handleChange(next: string) {
    if (next === optimisticValue) return;
    startTransition(async () => {
      setOptimisticValue(next);
      const result = await setHouseholdCurrencyAction(next === NONE ? null : next);
      if (result.error) toast.error(result.error);
      else toast.success(currencyDict.savedToast);
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <Label htmlFor="onboarding-currency" className="shrink-0">
        {dict.currencyLabel}
      </Label>
      <Select
        value={optimisticValue}
        onValueChange={(v) => handleChange(String(v))}
        disabled={!canChange || isPending}
      >
        <SelectTrigger id="onboarding-currency" className="w-full sm:w-72">
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
    </div>
  );
}
