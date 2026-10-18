// UX-48: where the Toaster sits. Pure so the node-environment suite can pin it
// (sonner.tsx itself needs a DOM). Phones put toasts at the top, because the
// bottom edge is the BottomNav, a bottom sheet's sticky footer and the
// shopping "Next up" dock: no bottom offset clears all three. Everything else
// keeps Sonner's bottom-right corner.

/** Below Tailwind's `sm`, where the dashboard swaps the sidebar for BottomNav. */
export const PHONE_QUERY = "(max-width: 639px)";

/** Clear of the notch / status bar, never closer than 16 px to the edge. */
export const TOAST_TOP = "max(1rem, calc(env(safe-area-inset-top) + 0.5rem))";

export type ToastPlacement = {
  position: "top-center" | "bottom-right";
  offset: { top: string } | undefined;
};

export function toastPlacement(phone: boolean): ToastPlacement {
  return phone
    ? { position: "top-center", offset: { top: TOAST_TOP } }
    : { position: "bottom-right", offset: undefined };
}
