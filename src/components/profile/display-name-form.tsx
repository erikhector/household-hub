"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useKeptFormValues } from "@/components/shared/use-kept-form-values";
import { updateProfileAction } from "@/app/dashboard/profile/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type FormState = { error?: string };

const initialState: FormState = {};

export function DisplayNameForm({
  displayName,
  dict,
}: {
  displayName: string;
  dict: Dictionary["profile"]["displayNameForm"];
}) {
  // UX-13: a rejected name stays in the field to fix, rather than snapping
  // back to the saved one.
  const kept = useKeptFormValues(["displayName"]);
  const [state, formAction, pending] = useActionState(async (
    prevState: FormState,
    formData: FormData,
  ): Promise<FormState> => {
    const result = await updateProfileAction(prevState, formData);
    if (result.error) return { error: result.error };
    toast.success(dict.saved);
    return {};
  }, initialState);

  return (
    <form action={formAction} onSubmit={kept.onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">{dict.label}</Label>
        <Input
          enterKeyHint="done"
          key={displayName}
          id="displayName"
          name="displayName"
          defaultValue={kept.values.displayName ?? displayName}
          required
          maxLength={60}
        />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? dict.saving : dict.save}
      </Button>
    </form>
  );
}
