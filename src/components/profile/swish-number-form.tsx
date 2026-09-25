"use client";

// GAP-7: the signed-in user's own Swish number. Household members who owe
// them money get a "Pay with Swish" link on the Budget page's "Who owes whom"
// card (src/components/budget/household-balances.tsx). The description says
// outright that the number is visible to household members, since that's
// the whole point of storing it — see User.swishNumber in schema.prisma.

import { useActionState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSwishNumberAction } from "@/app/dashboard/profile/actions";
import { INVALID_SWISH_NUMBER_ERROR, formatSwishNumber } from "@/lib/swish";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type FormState = { error?: string };

const initialState: FormState = {};

export function SwishNumberForm({
  swishNumber,
  dict,
}: {
  /** Stored alias ("46701234567"), or null when not set. */
  swishNumber: string | null;
  dict: Dictionary["profile"]["swishForm"];
}) {
  const [state, formAction, pending] = useActionState(async (
    prevState: FormState,
    formData: FormData,
  ): Promise<FormState> => {
    const result = await updateSwishNumberAction(prevState, formData);
    if (result.error) {
      // The action's validation error is English-only like the rest of
      // profile/actions.ts; this one is common enough to translate.
      return { error: result.error === INVALID_SWISH_NUMBER_ERROR ? dict.invalid : result.error };
    }
    toast.success(dict.saved);
    return {};
  }, initialState);

  // Shown the way Swedes write it ("070-123 45 67"), not as the stored
  // alias — the action accepts either form back.
  const displayValue = swishNumber ? formatSwishNumber(swishNumber) : "";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="swishNumber">{dict.label}</Label>
        <Input
          key={displayValue}
          id="swishNumber"
          name="swishNumber"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={dict.placeholder}
          defaultValue={displayValue}
          maxLength={24}
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? dict.saving : dict.save}
      </Button>
    </form>
  );
}
