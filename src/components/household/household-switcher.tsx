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

type HouseholdOption = { id: string; name: string; role: string };

const initialState: ActionState = {};

function CreateHouseholdDialog() {
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
          <Button variant="ghost" size="icon" className="size-7" aria-label="Create household">
            <Plus className="size-4" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new household</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-household-name">Household name</Label>
            <Input id="new-household-name" name="name" required autoFocus />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create household"}
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
}: {
  current: HouseholdOption;
  households: HouseholdOption[];
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className="h-auto flex-col items-start px-2 py-1">
              <span className="text-xs font-medium text-muted-foreground">Household</span>
              <span className="flex items-center gap-1 font-semibold">
                {current.name}
                <ChevronsUpDown className="size-3.5 text-muted-foreground" />
              </span>
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          {households.map((h) => (
            <DropdownMenuItem
              key={h.id}
              disabled={isPending || h.id === current.id}
              onClick={() => startTransition(() => switchHouseholdAction(h.id))}
            >
              {h.name}
              {h.id === current.id && (
                <span className="ml-auto text-xs text-muted-foreground">Current</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateHouseholdDialog />
    </div>
  );
}
