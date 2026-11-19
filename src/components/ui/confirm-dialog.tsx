"use client";

// Shared "are you sure?" wrapper for destructive/removal actions — renders
// as the same bottom-sheet-on-mobile/centered-on-desktop Dialog used
// everywhere else in the app (see components/ui/dialog.tsx), so a delete
// confirmation looks and behaves like every other popup here. Fully
// self-contained (owns its own open state and pending transition) so a
// call site only needs to swap its existing instant-delete button for
// `trigger` and move the actual delete call into `onConfirm`.

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogHandle,
} from "@/components/ui/dialog";
import { PendingLabel } from "@/components/ui/pending-label";

/**
 * What to toast when `onConfirm` throws instead of returning (UX-205: a
 * dropped request, offline or on a flaky mobile connection). The dashboard
 * layout passes its generic "something went wrong" string once, so none of
 * the call sites needs a copy of its own and the primitive no hardcoded
 * text. Without a provider a throw propagates as before.
 */
const FailedMessageContext = createContext<string | null>(null);
export function ConfirmDialogFailedMessage({ message, children }: { message: string; children: ReactNode }) {
  return <FailedMessageContext.Provider value={message}>{children}</FailedMessageContext.Provider>;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  variant = "destructive",
  alert = false,
  onConfirm,
  handle,
  finalFocus,
  children,
}: {
  /** The element that opens the dialog — usually the existing trash/remove
   * icon button, unchanged except its onClick moves into `onConfirm`.
   * Omit it when the dialog is opened through `handle` instead (e.g. from a
   * DropdownMenu item — see createDialogHandle). */
  trigger?: ReactElement;
  handle?: DialogHandle;
  /** Where focus goes on close when opened through `handle` (no trigger to
   * return to): the menu button it was opened from. */
  finalFocus?: RefObject<HTMLElement | null>;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  variant?: "destructive" | "default";
  /** Announce it as an `alertdialog` (an interruption that needs an answer)
   * rather than a plain `dialog`. Opt-in per call site, so existing ones and
   * the specs that find them by the `dialog` role keep working. */
  alert?: boolean;
  /** Extra controls between the description and the buttons (a checkbox
   * that changes what confirming does). */
  children?: ReactNode;
  /** May return an `{ error?: string }`-shaped result (this app's usual
   * server action return type) — a truthy `error` is toasted and the
   * dialog stays open so the user can retry; anything else closes it. A
   * throw (a dropped request) is treated like an error: the
   * ConfirmDialogFailedMessage text is toasted and the dialog stays open. */
  onConfirm: () => Promise<{ error?: string } | void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const failedMessage = useContext(FailedMessageContext);

  function handleConfirm() {
    startTransition(async () => {
      let result: { error?: string } | void;
      try {
        result = await onConfirm();
      } catch (error) {
        // A redirect (expired session) or notFound still goes to the router;
        // with no message to show, the throw reaches the error boundary as
        // it always did.
        unstable_rethrow(error);
        if (failedMessage === null) throw error;
        toast.error(failedMessage);
        return;
      }
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen} handle={handle}>
      {trigger && <DialogTrigger render={trigger} />}
      {/* Spread, not `role={alert ? … : undefined}`: an explicit undefined
          role overrides the popup's own `dialog` role and leaves it with none. */}
      <DialogContent finalFocus={finalFocus} {...(alert && { role: "alertdialog" })}>
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={() => setOpen(false)}>
            {cancelLabel}
          </Button>
          <Button variant={variant} disabled={isPending} onClick={handleConfirm}>
            <PendingLabel pending={isPending} busy={pendingLabel} idle={confirmLabel} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
