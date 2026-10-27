"use client";

import { useState, type ComponentProps } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createDialogHandle } from "@/components/ui/dialog";
import { LazyDialog, openLazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import { loadAddToPlanDialog } from "@/components/meal-planning/lazy-dialogs";
import type { AddToPlanDialog } from "@/components/meal-planning/add-to-plan-dialog";

/**
 * PERF-26: a recipe's "Add to plan" button with its dialog loaded on first
 * use. AddToPlanDialog used to own this button; it now opens through a handle
 * so the button stays in the page's own chunk (the Cook now tab renders it
 * from a server component, which can't hold the host itself).
 */
export function LazyAddToPlan(props: Omit<ComponentProps<typeof AddToPlanDialog>, "controlled" | "handle">) {
  const [handle] = useState(() => createDialogHandle());
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => openLazyDialog(handle)}
        {...preloadOnIntent(loadAddToPlanDialog)}
      >
        <CalendarPlus className="size-4" />
        {props.dict.addToPlanButton}
      </Button>
      <LazyDialog loader={loadAddToPlanDialog} handle={handle}>
        {(AddToPlan) => <AddToPlan {...props} handle={handle} />}
      </LazyDialog>
    </>
  );
}
