"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { pushDialogEntry } from "@/components/ui/dialog-history"
import { useKeyboardInset } from "@/components/ui/keyboard-inset"
import { commonCopy } from "@/lib/i18n/common"
import { getClientLocale } from "@/lib/i18n/client-locale"

// While the dialog is open it owns a history entry, so the phone's back
// gesture closes it instead of leaving the page (UX-11, DESIGN.md M7; the
// mechanics are in dialog-history.ts). Every dialog in the app goes through
// here, ConfirmDialog included, so none has to opt in.
function useBackGestureCloses(open: boolean, close: () => void) {
  const closeRef = React.useRef(close)
  React.useEffect(() => {
    closeRef.current = close
  })
  // Bumped when a back gesture closed the dialog. If its owner refused to
  // close (e.g. a dialog that stays open while saving), the effect re-runs
  // and pushes a fresh entry, so the next back still has one to pop.
  const [generation, setGeneration] = React.useState(0)
  React.useEffect(() => {
    if (!open) return
    let release: (() => void) | undefined
    // A tick late, so StrictMode's dev-only mount → unmount → mount doesn't
    // push, back() and push again: that back() is async, would land after
    // the second push, and close the dialog it just opened.
    const timer = setTimeout(() => {
      release = pushDialogEntry(() => {
        closeRef.current()
        setGeneration((value) => value + 1)
      })
    })
    return () => {
      clearTimeout(timer)
      release?.()
    }
  }, [open, generation])
}

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  actionsRef,
  ...props
}: DialogPrimitive.Root.Props) {
  // Most dialogs here are controlled, but an uncontrolled one (a bare
  // <Dialog> with a Trigger) still needs its open state tracked for the
  // history entry, so it's mirrored from onOpenChange.
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const ownActionsRef = React.useRef<DialogPrimitive.Root.Actions>(null)
  const actions = actionsRef ?? ownActionsRef

  // The root's own close() goes through onOpenChange like Escape or the X
  // does, so each dialog's close logic runs unchanged.
  useBackGestureCloses(open ?? uncontrolledOpen, () => actions.current?.close())

  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      open={open}
      defaultOpen={defaultOpen}
      actionsRef={actions}
      onOpenChange={(next, eventDetails) => {
        onOpenChange?.(next, eventDetails)
        if (!eventDetails.isCanceled) setUncontrolledOpen(next)
      }}
      {...props}
    />
  )
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  // UX-12: lifts the sheet above the iOS keyboard (see keyboard-inset.ts).
  useKeyboardInset();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // Mobile: a bottom sheet flush with the screen edges, capped to
          // most of the viewport height and scrollable so long forms don't
          // get clipped under the keyboard. dvh, not vh: on iOS Safari vh is
          // the viewport with the toolbars hidden, so 85vh overshoots the
          // visible screen and the sheet's bottom sits out of reach.
          // bottom-[var(--kb-inset)]: the iOS keyboard's height (0 when
          // closed or on Android, where interactiveWidget resizes the layout
          // viewport instead) — without it the fixed sheet sits behind the
          // keyboard (UX-12).
          // overscroll-contain keeps a swipe that hits the end from
          // rubber-banding the page behind. This is the dialog's scroller, so
          // don't give content a viewport-height one of its own (max-h-[70vh]
          // overflow-y-auto): iOS Safari won't pass a swipe between the two
          // and the sheet gets stuck (dialog-scroll.test.ts guards this).
          // grid-cols-1 (minmax(0, 1fr)), not the implicit auto column: an
          // auto track grows to its widest child's min-content, so a long
          // row (the recipe form's ingredient rows) widened the whole sheet
          // past the screen once no inner scroller was there to clip it.
          // sm+: the original centered modal.
          "fixed inset-x-0 top-auto bottom-[var(--kb-inset,0px)] z-50 grid grid-cols-1 max-h-[85dvh] overscroll-contain w-full max-w-none translate-x-0 translate-y-0 gap-4 overflow-y-auto rounded-t-2xl bg-popover p-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-popover-foreground ring-1 ring-foreground/10 duration-150 outline-none data-open:animate-in data-open:slide-in-from-bottom data-open:fade-in-0 data-closed:animate-out data-closed:slide-out-to-bottom data-closed:fade-out-0",
          // sm:inset-x-auto must precede sm:left-1/2: both are in tailwind-merge's
          // "left" conflict group, and it keeps only the later class — reversing
          // this order silently drops sm:left-1/2, leaving the dialog at left:0
          // (its fixed-position static position) instead of centered.
          "sm:top-1/2 sm:bottom-auto sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-4 sm:pb-4 sm:duration-100 sm:data-open:zoom-in-95 sm:data-open:slide-in-from-bottom-0 sm:data-closed:zoom-out-95 sm:data-closed:slide-out-to-bottom-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">{commonCopy[getClientLocale()].close}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      // pr-10 keeps a long (Swedish) title from running under the close
      // button in the top-right corner.
      className={cn("flex flex-col gap-2 pr-10", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // UX-12 (DESIGN.md M2): on phones the footer sticks to the sheet's
        // bottom, so Save stays in the thumb zone in a long form instead of
        // scrolling out of view. max-sm:bg-popover (opaque, over the base
        // translucent strip) so the content scrolling underneath doesn't
        // show through. sm+: the original static row.
        // The stick offset is negative, not 0: `position: sticky` constrains
        // the footer's MARGIN box, and the `-mb-[...]` full-bleed pull below
        // is part of that box — with `bottom-0` the border box stuck exactly
        // that margin (16px, more under a home indicator) above the sheet
        // bottom (measured: footer 16.0px short while scrolled). Negating the
        // same `max(1rem, env(safe-area-inset-bottom))` puts the border box
        // exactly at the sheet bottom at every safe-area size.
        "max-sm:sticky max-sm:-bottom-[max(1rem,env(safe-area-inset-bottom))] -mx-4 -mb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col-reverse gap-2 border-t bg-muted/50 max-sm:bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:-mb-4 sm:flex-row sm:justify-end sm:rounded-b-xl sm:pb-4",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          {commonCopy[getClientLocale()].close}
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

// Opens a Dialog from somewhere other than its own Trigger — e.g. a menu
// item, whose popup (and anything rendered inside it) unmounts as the menu
// closes, so the Dialog has to live outside the menu. Pass the handle to the
// Dialog's `handle` prop and call `handle.open(null)` from the menu item.
// Opening this way still goes through the Dialog's onOpenChange, so a
// component's open-time reset logic runs the same as for a Trigger press.
const createDialogHandle = DialogPrimitive.createHandle
type DialogHandle = DialogPrimitive.Handle<unknown>

export {
  createDialogHandle,
  type DialogHandle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
