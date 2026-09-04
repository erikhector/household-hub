"use client";

import { useActionState } from "react";
import { Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateEmailAction } from "@/app/dashboard/profile/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type FormState = { error?: string; success?: boolean };

const initialState: FormState = {};

export function EmailForm({
  email,
  dict,
}: {
  email: string;
  dict: Dictionary["profile"]["emailForm"];
}) {
  const [state, formAction, pending] = useActionState(async (
    prevState: FormState,
    formData: FormData,
  ): Promise<FormState> => {
    const result = await updateEmailAction(prevState, formData);
    return result.error ? { error: result.error } : { success: true };
  }, initialState);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="currentEmail">{dict.currentEmailLabel}</Label>
        <Input id="currentEmail" defaultValue={email} disabled />
      </div>
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="newEmail">{dict.newEmailLabel}</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="newEmail"
              name="newEmail"
              type="email"
              required
              autoComplete="email"
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="currentPasswordForEmail">{dict.currentPasswordLabel}</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="currentPasswordForEmail"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="pl-8"
            />
          </div>
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.success && <p className="text-sm text-emerald-500">{dict.saved}</p>}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? dict.saving : dict.save}
        </Button>
      </form>
    </div>
  );
}
