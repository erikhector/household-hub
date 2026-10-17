"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PendingLabel } from "@/components/ui/pending-label";
import { renameHouseholdAction } from "@/lib/actions/household";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// UX-75's Household page card. Rendered for the owner only (the page gates
// it, and renameHouseholdAction enforces the same server-side). The name
// typed in a hurry at signup used to be permanent. Saves on an explicit
// button rather than on change, since a half-typed name must never reach the
// header and the invite emails. The field is uncontrolled-ish: it keeps the
// typed text, and the page's revalidation hands back the saved name as
// `name` on the next render.
export function RenameHousehold({
  name,
  dict,
}: {
  name: string;
  dict: Dictionary["household"]["rename"];
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await renameHouseholdAction(value);
      if (result.error) setError(result.error);
      else toast.success(dict.savedToast);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
          <Pencil className="size-4 shrink-0" />
          {dict.title}
        </h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="household-name">{dict.label}</Label>
        <Input
          autoComplete="off"
          enterKeyHint="done"
          id="household-name"
          name="name"
          required
          maxLength={60}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="sm:w-72"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <div>
        <Button type="submit" disabled={isPending || value.trim() === name} className="w-full sm:w-auto">
          <PendingLabel pending={isPending} busy={dict.saving} idle={dict.save} />
        </Button>
      </div>
    </form>
  );
}
