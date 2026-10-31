"use client";

import { cloneElement, useState, type ComponentProps, type ReactElement } from "react";
import { createDialogHandle, type DialogHandle } from "@/components/ui/dialog";
import {
  LazyDialog,
  openLazyDialog,
  preloadOnIntent,
  type LazyDialogLoader,
} from "@/components/ui/lazy-dialog";
import {
  loadLogSharedExpenseDialog,
  loadPlannedExpenseDialog,
  loadRecurringTemplateDialog,
  loadTransactionDialog,
} from "@/components/budget/lazy-dialogs";
import type { TransactionDialog } from "@/components/budget/transaction-dialog";
import type { RecurringTemplateDialog } from "@/components/budget/recurring-template-dialog";
import type { PlannedExpenseDialog } from "@/components/budget/planned-expense-dialog";
import type { LogSharedExpenseDialog } from "@/components/personal-budget/log-shared-expense-dialog";

// PERF-30: the budget dialogs used to own their trigger (`trigger` prop, a
// Base UI DialogTrigger), so their whole form had to ship with the page. They
// now open through a handle, and these wrappers keep every call site as it
// was: the page passes the same `trigger` element, which stays in the page's
// own chunk and is the only thing rendered until the first tap, when the real
// dialog's chunk is mounted (ui/lazy-dialog.tsx). Rows render many of these,
// so each wrapper makes its own handle; the loader is shared, so the chunk is
// fetched once.
//
// The recurring-item and planned-item wrappers also take a caller's `handle`
// in place of `trigger`, for a dialog opened from a menu item (the Bills &
// income card's Add menu, a row's "…" menu): a dialog rendered inside the
// menu would unmount as it closes. Open it with openLazyDialog(handle), and
// pass `finalFocus` (the menu's trigger), since a handle-opened dialog has no
// trigger of its own to hand focus back to on close.

/** The trigger, opening `handle` through its LazyDialog host. Its own props
 * (className, aria-label, ref, disabled, …) are kept. */
function withOpener(
  trigger: ReactElement,
  handle: DialogHandle,
  loader: Pick<LazyDialogLoader<never>, "preload">,
) {
  return cloneElement(trigger as ReactElement<Record<string, unknown>>, {
    "aria-haspopup": "dialog",
    onClick: () => openLazyDialog(handle),
    ...preloadOnIntent(loader),
  });
}

export function LazyTransactionDialog({
  trigger,
  ...props
}: { trigger: ReactElement } & Omit<ComponentProps<typeof TransactionDialog>, "handle">) {
  const [handle] = useState(() => createDialogHandle());
  return (
    <>
      {withOpener(trigger, handle, loadTransactionDialog)}
      <LazyDialog loader={loadTransactionDialog} handle={handle}>
        {(Dialog) => <Dialog {...props} handle={handle} />}
      </LazyDialog>
    </>
  );
}

export function LazyRecurringTemplateDialog({
  trigger,
  handle: callerHandle,
  ...props
}: ({ trigger: ReactElement; handle?: never } | { trigger?: never; handle: DialogHandle }) &
  Omit<ComponentProps<typeof RecurringTemplateDialog>, "handle">) {
  const [ownHandle] = useState(() => createDialogHandle());
  const handle = callerHandle ?? ownHandle;
  return (
    <>
      {trigger && withOpener(trigger, handle, loadRecurringTemplateDialog)}
      <LazyDialog loader={loadRecurringTemplateDialog} handle={handle}>
        {(Dialog) => <Dialog {...props} handle={handle} />}
      </LazyDialog>
    </>
  );
}

export function LazyPlannedExpenseDialog({
  trigger,
  handle: callerHandle,
  ...props
}: ({ trigger: ReactElement; handle?: never } | { trigger?: never; handle: DialogHandle }) &
  Omit<ComponentProps<typeof PlannedExpenseDialog>, "handle">) {
  const [ownHandle] = useState(() => createDialogHandle());
  const handle = callerHandle ?? ownHandle;
  return (
    <>
      {trigger && withOpener(trigger, handle, loadPlannedExpenseDialog)}
      <LazyDialog loader={loadPlannedExpenseDialog} handle={handle}>
        {(Dialog) => <Dialog {...props} handle={handle} />}
      </LazyDialog>
    </>
  );
}

export function LazyLogSharedExpenseDialog({
  trigger,
  ...props
}: { trigger: ReactElement } & Omit<ComponentProps<typeof LogSharedExpenseDialog>, "handle">) {
  const [handle] = useState(() => createDialogHandle());
  return (
    <>
      {withOpener(trigger, handle, loadLogSharedExpenseDialog)}
      <LazyDialog loader={loadLogSharedExpenseDialog} handle={handle}>
        {(Dialog) => <Dialog {...props} handle={handle} />}
      </LazyDialog>
    </>
  );
}
