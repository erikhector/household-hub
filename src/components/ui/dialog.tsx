"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { pushDialogEntry } from "@/components/ui/dialog-history"
import { useKeyboardInset } from "@/components/ui/keyboard-inset"
import { resolveSheetInitialFocus, type InitialFocus } from "@/components/ui/sheet-focus"
import { commonCopy } from "@/lib/i18n/common"
import { getDocumentLocale } from "@/lib/i18n/client-locale"

// UX-34: every dialog is a Base UI Drawer, not a plain Dialog. Drawer is
// Dialog plus gestures (its Title, Description and Close *are* Dialog's), so
// the focus trap, Escape, outside press and aria wiring are unchanged; what
// it adds is the native bottom-sheet behaviour on phones: drag the sheet down
// to dismiss (velocity-aware, rubber-banding when pulled up past its top,
// handing off to the sheet's scroll so a drag only moves the sheet once its
// content is scrolled to the top), half/full snap points for long forms, and
// the iOS-style background scale-down (DrawerIndent in the root layout).
// Base UI's own pointer handling was used rather than a hand-written one, as
// the backlog item asked. From `sm` the same parts render the centred modal,
// with the gesture switched off (see `swipeOff` below).
//
// Every gesture keeps a visible button (DESIGN.md M7): the X closes, the
// grabber of a long form is a button that toggles half/full, and Escape and
// the back gesture still close (useBackGestureCloses).

// The `sm` breakpoint (40rem): below it dialogs are bottom sheets.
const PHONE_QUERY = "(width < 40rem)"
const COARSE_POINTER_QUERY = "(pointer: coarse)"

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }
}

// Server snapshot is false: dialogs are closed during SSR/hydration, and the
// value is only read once one opens.
function useMediaQuery(query: string) {
  const subscribe = React.useMemo(() => subscribeMedia(query), [query])
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}

// Snap points of a long form on a phone: half the screen, and full (the
// sheet's own max height, 85dvh — Base UI clamps 1 to the popup). It opens
// full, so the first field and Save are where UX-12 put them; a drag down
// rests at half, to peek at the page behind, and a further drag dismisses.
const HALF = 0.5
const FULL = 1
const SNAP_POINTS: DrawerPrimitive.Root.SnapPoint[] = [HALF, FULL]

type SheetState = {
  /** The sheet has half/full snap points (a long form, on a phone). */
  snaps: boolean
  expanded: boolean
  toggleExpanded: () => void
}

const SheetContext = React.createContext<SheetState>({
  snaps: false,
  expanded: true,
  toggleExpanded: () => {},
})

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

type DialogProps = Omit<
  DrawerPrimitive.Root.Props,
  "snapPoints" | "snapPoint" | "defaultSnapPoint" | "onSnapPointChange" | "swipeDirection"
> & {
  /**
   * A form taller than half a phone screen (the recipe form, add/edit
   * item): on phones the sheet gets half/full snap points (UX-34).
   */
  longForm?: boolean
}

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  actionsRef,
  longForm = false,
  ...props
}: DialogProps) {
  // Most dialogs here are controlled, but an uncontrolled one (a bare
  // <Dialog> with a Trigger) still needs its open state tracked for the
  // history entry, so it's mirrored from onOpenChange.
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const ownActionsRef = React.useRef<DrawerPrimitive.Root.Actions>(null)
  const actions = actionsRef ?? ownActionsRef

  // The root's own close() goes through onOpenChange like Escape or the X
  // does, so each dialog's close logic runs unchanged.
  useBackGestureCloses(open ?? uncontrolledOpen, () => actions.current?.close())

  // Snap points only on phones: from `sm` the dialog is a centred modal.
  const phone = useMediaQuery(PHONE_QUERY)
  const snaps = longForm && phone
  // Controlled (always, so it never flips between controlled and not) so the
  // grabber button can toggle it. Every open starts full: Base UI resets it
  // to defaultSnapPoint on close.
  const [snapPoint, setSnapPoint] = React.useState<DrawerPrimitive.Root.SnapPoint | null>(FULL)
  const sheet = React.useMemo<SheetState>(
    () => ({
      snaps,
      expanded: snapPoint === FULL,
      toggleExpanded: () => setSnapPoint((point) => (point === FULL ? HALF : FULL)),
    }),
    [snaps, snapPoint]
  )

  return (
    <SheetContext.Provider value={sheet}>
      <DrawerPrimitive.Root
        data-slot="dialog"
        open={open}
        defaultOpen={defaultOpen}
        actionsRef={actions}
        snapPoints={snaps ? SNAP_POINTS : undefined}
        defaultSnapPoint={FULL}
        snapPoint={snapPoint}
        onSnapPointChange={(point) => setSnapPoint(point)}
        onOpenChange={(next, eventDetails) => {
          onOpenChange?.(next, eventDetails)
          if (eventDetails.isCanceled) return
          setUncontrolledOpen(next)
          if (!next) setSnapPoint(FULL)
        }}
        {...props}
      />
    </SheetContext.Provider>
  )
}

function DialogTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DrawerPrimitive.Portal.Props) {
  return <DrawerPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // Fades out as the sheet is dragged down (Base UI writes the drag's
        // progress, 0 → 1, to --drawer-swipe-progress).
        "fixed inset-0 isolate z-50 bg-black/10 opacity-[calc(1-var(--drawer-swipe-progress,0))] duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

// The pill at the top of a phone sheet. It says "this drags", so it's only
// there because the sheet really does drag now (UX-12 removed it while it
// didn't). On a long form it's also the button that does what the half/full
// drag does (M7: no gesture-only action); the pseudo-element gives it a
// 44px-tall target (M3) without adding height to the sheet.
function SheetGrabber() {
  const { snaps, expanded, toggleExpanded } = React.useContext(SheetContext)
  const copy = commonCopy[getDocumentLocale()]
  const pill = <span aria-hidden className="block h-1 w-10 rounded-full bg-muted-foreground/30" />
  return (
    <div data-slot="dialog-grabber" className="flex h-4 shrink-0 touch-none items-end justify-center sm:hidden">
      {snaps ? (
        <button
          type="button"
          aria-label={expanded ? copy.collapseSheet : copy.expandSheet}
          aria-expanded={expanded}
          onClick={toggleExpanded}
          className="relative flex h-4 w-16 items-end justify-center outline-none after:absolute after:-inset-x-2 after:-top-1 after:-bottom-6 focus-visible:ring-3 focus-visible:ring-ring/50 rounded-full"
        >
          {pill}
        </button>
      ) : (
        pill
      )}
    </div>
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  initialFocus,
  ...props
}: Omit<DrawerPrimitive.Popup.Props, "initialFocus"> & {
  showCloseButton?: boolean
  initialFocus?: InitialFocus
}) {
  // UX-12: lifts the sheet above the iOS keyboard (see keyboard-inset.ts).
  useKeyboardInset();
  const phone = useMediaQuery(PHONE_QUERY)
  const coarsePointer = useMediaQuery(COARSE_POINTER_QUERY)
  const popupRef = React.useRef<HTMLDivElement>(null)
  return (
    <DialogPortal>
      <DialogOverlay />
      {/* The viewport is where Base UI listens for the drag (and locks
          touch scrolling behind the sheet). It covers the screen, so a tap
          outside the sheet lands on it and still closes the dialog. */}
      <DrawerPrimitive.Viewport data-slot="dialog-viewport" className="fixed inset-0 z-50">
        <DrawerPrimitive.Popup
          ref={popupRef}
          data-slot="dialog-content"
          // No drag from `sm` up: the centred modal isn't a sheet, and a
          // tablet's touch would otherwise drag it off-centre.
          data-base-ui-swipe-ignore={phone ? undefined : ""}
          // Touch open: the sheet takes focus, not the first field, so the
          // keyboard doesn't cover the sheet before it's read (sheet-focus.ts).
          initialFocus={(interactionType) =>
            resolveSheetInitialFocus({
              interactionType,
              coarsePointer,
              popup: popupRef.current,
              initialFocus,
            })
          }
          className={cn(
            // Mobile: a bottom sheet flush with the screen edges, capped to
            // most of the viewport height. dvh, not vh: on iOS Safari vh is
            // the viewport with the toolbars hidden, so 85vh overshoots the
            // visible screen and the sheet's bottom sits out of reach.
            // bottom-[var(--kb-inset)]: the iOS keyboard's height (0 when
            // closed or on Android, where interactiveWidget resizes the layout
            // viewport instead) — without it the fixed sheet sits behind the
            // keyboard (UX-12).
            // The sheet is a column: the grabber, then the body below, which
            // is the one scroller (dialog-scroll.test.ts). overflow-hidden
            // clips the body to the rounded corners.
            // sm+: the original centered modal.
            "fixed inset-x-0 top-auto bottom-[var(--kb-inset,0px)] z-50 flex flex-col max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-t-2xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10 duration-150 outline-none data-open:animate-in data-open:slide-in-from-bottom data-open:fade-in-0 data-closed:animate-out data-closed:slide-out-to-bottom data-closed:fade-out-0",
            // UX-34, the drag: Base UI writes the finger's travel to
            // --drawer-swipe-movement-y (rubber-banded past the top) and a
            // resting snap point to --drawer-snap-point-offset. `transform`,
            // not Tailwind's translate-*, which set the separate `translate`
            // property the sm+ centring uses. A released drag that doesn't
            // dismiss settles back with a transition; no transition while
            // the finger is down, or the sheet lags behind it; and none under
            // reduced motion, where it just jumps to rest.
            // Base UI registers its drag variables with `inherits: false`,
            // so the snap offset is copied into --sheet-snap-offset here for
            // DialogFooter (a descendant) to read.
            "[--sheet-snap-offset:var(--drawer-snap-point-offset,0px)] [transform:translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))] transition-transform ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:transition-none data-swiping:select-none motion-reduce:transition-none",
            // sm:inset-x-auto must precede sm:left-1/2: both are in tailwind-merge's
            // "left" conflict group, and it keeps only the later class — reversing
            // this order silently drops sm:left-1/2, leaving the dialog at left:0
            // (its fixed-position static position) instead of centered.
            "sm:top-1/2 sm:bottom-auto sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:[transform:none] sm:rounded-xl sm:duration-100 sm:data-open:zoom-in-95 sm:data-open:slide-in-from-bottom-0 sm:data-closed:zoom-out-95 sm:data-closed:slide-out-to-bottom-0",
            className
          )}
          {...props}
        >
          <SheetGrabber />
          {/* The body scrolls; nothing inside it may add a viewport-height
              scroller of its own (max-h-[70vh] overflow-y-auto): iOS Safari
              won't pass a swipe between the two and the sheet gets stuck
              (dialog-scroll.test.ts guards this). Base UI hands a downward
              drag from here to the sheet once the body is scrolled to its
              top. overscroll-contain keeps a swipe that hits the end from
              rubber-banding the page behind.
              grid-cols-1 (minmax(0, 1fr)), not the implicit auto column: an
              auto track grows to its widest child's min-content, so a long
              row (the recipe form's ingredient rows) widened the whole sheet
              past the screen once no inner scroller was there to clip it.
              pt-1: the grabber row above makes up the rest of the old pt-5. */}
          <DrawerPrimitive.Content
            data-slot="dialog-body"
            className="relative grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto overscroll-contain p-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-4"
          >
            {children}
            {showCloseButton && (
              <DrawerPrimitive.Close
                data-slot="dialog-close"
                render={
                  <Button
                    variant="ghost"
                    className="absolute top-0 right-2 sm:top-2"
                    size="icon-sm"
                  />
                }
              >
                <XIcon
                />
                <span className="sr-only">{commonCopy[getDocumentLocale()].close}</span>
              </DrawerPrimitive.Close>
            )}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
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
        // UX-34: a long form resting at its half snap point is pushed down
        // by the snap offset (--sheet-snap-offset, copied from Base UI's
        // --drawer-snap-point-offset on the popup), so its bottom part is off screen;
        // the same offset lifts the footer to the visible bottom edge, and
        // Save stays reachable at half height too (0 everywhere else).
        "max-sm:sticky max-sm:bottom-[calc(var(--sheet-snap-offset,0px)_-_max(1rem,env(safe-area-inset-bottom)))] -mx-4 -mb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col-reverse gap-2 border-t bg-muted/50 max-sm:bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:-mb-4 sm:flex-row sm:justify-end sm:rounded-b-xl sm:pb-4",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DrawerPrimitive.Close render={<Button variant="outline" />}>
          {commonCopy[getDocumentLocale()].close}
        </DrawerPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
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
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
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
const createDialogHandle = DrawerPrimitive.createHandle
type DialogHandle = DrawerPrimitive.Handle<unknown>

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
