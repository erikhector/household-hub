"use client";

import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { createDialogHandle } from "@/components/ui/dialog";
import { LazyDialog, openLazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import { loadChangeUnitDialog, loadMergeIntoDialog } from "@/components/inventory/lazy-dialogs";
import type { ChangeUnitDialog } from "@/components/inventory/item-page/change-unit-dialog";
import type { MergeIntoDialog } from "@/components/inventory/catalog/merge-into-dialog";

// PERF-26: the item page's two dialogs with their buttons kept here, in the
// page's own chunk, and the dialogs loaded on first use. The page is a
// Server Component, so it can't hold the handle or the host itself (the same
// split as meal planning's LazyAddToPlan).

export function LazyChangeUnit(props: Omit<ComponentProps<typeof ChangeUnitDialog>, "handle">) {
  const [handle] = useState(() => createDialogHandle());
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => openLazyDialog(handle)}
        {...preloadOnIntent(loadChangeUnitDialog)}
      >
        {props.dict.changeUnit}
      </Button>
      <LazyDialog loader={loadChangeUnitDialog} handle={handle}>
        {(ChangeUnit) => <ChangeUnit {...props} handle={handle} />}
      </LazyDialog>
    </>
  );
}

export function LazyMergeInto(props: Omit<ComponentProps<typeof MergeIntoDialog>, "handle">) {
  const [handle] = useState(() => createDialogHandle());
  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-haspopup="dialog"
        className="h-auto max-sm:h-auto pointer-coarse:h-auto max-w-full min-h-8 max-sm:min-h-11 pointer-coarse:min-h-11 w-fit py-1 whitespace-normal"
        onClick={() => openLazyDialog(handle)}
        {...preloadOnIntent(loadMergeIntoDialog)}
      >
        {props.dict.mergeInto}
      </Button>
      <LazyDialog loader={loadMergeIntoDialog} handle={handle}>
        {(MergeInto) => <MergeInto {...props} handle={handle} />}
      </LazyDialog>
    </>
  );
}
