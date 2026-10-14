"use client";

import { useActionState, useState, useTransition } from "react";
import { ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createHouseholdAction, switchHouseholdAction } from "@/lib/actions/household";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

type HouseholdOption = { id: string; name: string; role: string };

const initialState: ActionState = {};

function CreateHouseholdDialog({ dict }: { dict: Dictionary["household"]["switcher"] }) {
  const [open, setOpen] = useState(false);
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
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={dict.createAriaLabel}>
            <Plus className="size-4" />
          </Button>
        }
      />
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

export function HouseholdSwitcher({
  current,
  households,
  dict,
}: {
  current: HouseholdOption;
  households: HouseholdOption[];
  dict: Dictionary["household"]["switcher"];
}) {
  const [isPending, startTransition] = useTransition();
  const switcherDict = dict;

  return (
    // w-full + the "+" button's ml-auto (UX-26): the row spans its
    // container, so "+" sits at the right edge of the phone header (and of
    // the expanded sidebar) instead of floating wherever the household name
    // happens to end.
    <div className="flex w-full min-w-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className="h-auto min-w-0 flex-col items-start px-2 py-1">
              <span className="text-xs font-medium text-muted-foreground">{switcherDict.label}</span>
              <span className="flex min-w-0 max-w-full items-center gap-1 font-semibold">
                <span className="min-w-0 line-clamp-2 break-words sm:line-clamp-1" title={current.name}>
                  {current.name}
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
              </span>
            </Button>
          }
        />
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
                  {switcherDict.current}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateHouseholdDialog dict={switcherDict} />
    </div>
  );
}
