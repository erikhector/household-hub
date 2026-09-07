"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "@/app/dashboard/profile/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type FormState = { error?: string; success?: boolean };

const initialState: FormState = {};

export function DisplayNameForm({
  displayName,
  dict,
}: {
  displayName: string;
  dict: Dictionary["profile"]["displayNameForm"];
}) {
  const [state, formAction, pending] = useActionState(async (
    prevState: FormState,
    formData: FormData,
  ): Promise<FormState> => {
    const result = await updateProfileAction(prevState, formData);
    return result.error ? { error: result.error } : { success: true };
  }, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">{dict.label}</Label>
        <Input
          key={displayName}
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          required
          maxLength={60}
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && <p className="text-sm text-emerald-500">{dict.saved}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? dict.saving : dict.save}
      </Button>
    </form>
  );
}
