"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "@/app/dashboard/profile/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type ProfileFormState = { error?: string; success?: boolean };

const initialState: ProfileFormState = {};

export function ProfileForm({
  displayName,
  email,
  dict,
}: {
  displayName: string;
  email: string;
  dict: Dictionary["profile"];
}) {
  const [state, formAction, pending] = useActionState(async (
    prevState: ProfileFormState,
    formData: FormData,
  ): Promise<ProfileFormState> => {
    const result = await updateProfileAction(prevState, formData);
    return result.error ? { error: result.error } : { success: true };
  }, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{dict.email}</Label>
        <Input id="email" defaultValue={email} disabled />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">{dict.displayName}</Label>
        <Input
          key={displayName}
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          required
          autoFocus
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
