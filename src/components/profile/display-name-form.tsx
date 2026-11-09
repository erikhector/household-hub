"use client";

import { useActionState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useKeptFormValues } from "@/components/shared/use-kept-form-values";
import { useFormDirty } from "@/components/shared/use-form-dirty";
import { FieldError, fieldErrorId } from "@/components/auth/field-error";
import { useRequiredFields } from "@/components/shared/use-required-fields";
import { updateProfileAction } from "@/app/dashboard/profile/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

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

  const { dirty, formProps } = useFormDirty(pending);
  // UX-183b: an empty (or all-space) name is worded under the field in the
  // page's language (`noValidate`), not by the browser's own bubble.
  const req = useRequiredFields();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const blocked = req.check(event, [{ name: "displayName", id: "displayName", message: dict.nameRequired }]);
    if (!blocked) kept.onSubmit(event);
  }

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      noValidate
      {...formProps}
      onInput={(event) => {
        formProps.onInput();
        req.onInput(event);
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">{dict.label}</Label>
        <Input
          enterKeyHint="done"
          key={displayName}
          id="displayName"
          name="displayName"
          autoComplete="name"
          defaultValue={kept.values.displayName ?? displayName}
          required
          maxLength={60}
          aria-invalid={req.messageFor("displayName") ? true : undefined}
          aria-describedby={req.messageFor("displayName") ? fieldErrorId("displayName") : undefined}
        />
        <FieldError fieldId="displayName">{req.messageFor("displayName")}</FieldError>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" variant={dirty ? "default" : "secondary"} disabled={pending} className="self-start">
        <PendingLabel pending={pending} busy={dict.saving} idle={dict.save} />
      </Button>
    </form>
  );
}
