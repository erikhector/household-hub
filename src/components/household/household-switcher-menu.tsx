"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createHouseholdAction, switchHouseholdAction } from "@/lib/actions/household";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";
import { HouseholdSwitcherTrigger, type HouseholdOption } from "@/components/household/household-switcher";

// PERF-27: the switcher's popups, loaded on first use. household-switcher.tsx
// keeps the trigger in every page's chunk; this file is the dropdown with
// the household list and the create-household form, which nobody sees until
// they tap the trigger. It renders its own trigger (the same one) because a
// Base UI menu positions itself against the trigger inside its Root, and
// mounts open (`defaultOpen`) when the tap that asked for it was the first.

const initialState: ActionState = {};

// Controlled by its opener (the switcher here, the More menu for a
// single-household user, UX-158): the dropdown item opens it, and it lives outside
// the menu's content because that unmounts as soon as the menu closes.
export function CreateHouseholdDialog({
  dict,
  open,
  setOpen,
}: {
  dict: Dictionary["household"]["switcher"];
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await createHouseholdAction(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.createNew}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-household-name">{dict.nameLabel}</Label>
            <Input autoComplete="off" enterKeyHint="done" id="new-household-name" name="name" required maxLength={60} />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              <PendingLabel pending={pending} busy={dict.creating} idle={dict.create} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HouseholdSwitcherMenu({
  current,
  households,
  dict,
}: {
  current: HouseholdOption;
  households: HouseholdOption[];
  dict: Dictionary["household"]["switcher"];
}) {
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger render={<HouseholdSwitcherTrigger current={current} dict={dict} />} />
        <DropdownMenuContent align="start" className="max-w-[16rem]">
          {households.map((h) => (
            <DropdownMenuItem
              key={h.id}
              className="min-w-0"
              disabled={isPending || h.id === current.id}
              onClick={() => startTransition(() => switchHouseholdAction(h.id))}
            >
              <span className="min-w-0 line-clamp-2 break-words sm:line-clamp-1" title={h.name}>
                {h.name}
              </span>
              {h.id === current.id && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {dict.current}
                </span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {dict.createMenuItem}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateHouseholdDialog dict={dict} open={createOpen} setOpen={setCreateOpen} />
    </>
  );
}
