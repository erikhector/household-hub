// UX-34: where focus lands when a dialog opens. On a phone, focusing a text
// field pops the on-screen keyboard, which covers half the sheet before the
// user has even read its title, so a touch-opened sheet focuses the sheet
// itself instead: VoiceOver/TalkBack read its title (aria-labelledby), the
// first swipe or Tab goes to the first field, and the keyboard stays down
// until the user taps a field. A mouse or keyboard open (desktop, a phone
// with a hardware keyboard) keeps the first field focused, ready to type.
//
// A dialog opened without a pointer of its own (a menu item, a handle's
// open(null)) reports no interaction type, so a coarse pointer — a phone or
// tablet — decides then. Only "keyboard" is trusted to mean a keyboard is
// there.
//
// The dialog's own `initialFocus` (a ref to the field that should get focus
// on desktop, say) still applies to every non-touch open, so callers don't
// each re-implement the touch case.

type FocusResult = boolean | void | HTMLElement | null

export type InitialFocus =
  | boolean
  | { current: HTMLElement | null }
  | ((interactionType: string) => FocusResult)
  | undefined

export function resolveSheetInitialFocus({
  interactionType,
  coarsePointer,
  popup,
  initialFocus,
}: {
  interactionType: string
  coarsePointer: boolean
  popup: HTMLElement | null
  initialFocus: InitialFocus
}): FocusResult {
  const touch = interactionType === "touch" || (interactionType === "" && coarsePointer)
  if (touch) return popup
  if (initialFocus === undefined) return true
  if (typeof initialFocus === "function") return initialFocus(interactionType)
  if (typeof initialFocus === "boolean") return initialFocus
  return initialFocus.current
}
