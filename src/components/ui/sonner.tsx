"use client"

import { useTheme } from "next-themes"
import { useSyncExternalStore } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

import { PHONE_QUERY, TOAST_TOP, toastPlacement } from "./toast-placement"

// The BottomNav shows below Tailwind's `sm` (640 px) but Sonner's own phone
// layout switches at 600 px, so the Toaster decides "phone" itself.
function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  // UX-48: on phones the bottom edge belongs to controls. The fixed BottomNav,
  // a bottom sheet's sticky footer ("Complete list", "Copy") and the shopping
  // "Next up" dock all sit in the band a bottom toast used to occupy, so
  // after "Put away & finish" two toasts hid "Complete list" and an Undo toast
  // covered a dock row. No bottom offset can clear all of them (their heights
  // vary), so phone toasts go to the top, where nothing but the toast is
  // tappable. The top inset keeps them out of the notch / status bar.
  // Desktop keeps Sonner's bottom-right corner, where no sheet footer exists.
  // The server snapshot is `false`: a toast never renders during SSR.
  const phone = useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  )

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      // richColors tints success/error/warning toasts green/red/amber so
      // the outcome reads at a glance. Sonner's own rich palette doesn't
      // match ours, so each type is re-pointed at the app's status tokens:
      // the status colour as text on a --status-tint (10% light, 20% dark,
      // see globals.css) mix of it over the popover, which is what those
      // tokens are tuned to hold 4.5:1 on. Info stays neutral — it's news,
      // not an outcome. These have to be inline: Sonner sets the same
      // variables on this element from its stylesheet, per theme. Mixed in
      // oklab, not oklch: an oklch mix interpolates hue too, so green over
      // the violet popover came out blue and amber came out pink.
      richColors
      {...toastPlacement(phone)}
      mobileOffset={{ left: 16, right: 16, top: TOAST_TOP }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--success-bg": "color-mix(in oklab, var(--success) var(--status-tint), var(--popover))",
          "--success-text": "var(--success)",
          "--success-border": "color-mix(in oklab, var(--success) 30%, var(--popover))",
          "--error-bg": "color-mix(in oklab, var(--destructive) var(--status-tint), var(--popover))",
          "--error-text": "var(--destructive)",
          "--error-border": "color-mix(in oklab, var(--destructive) 30%, var(--popover))",
          "--warning-bg": "color-mix(in oklab, var(--warning) var(--status-tint), var(--popover))",
          "--warning-text": "var(--warning)",
          "--warning-border": "color-mix(in oklab, var(--warning) 30%, var(--popover))",
          "--info-bg": "var(--popover)",
          "--info-text": "var(--popover-foreground)",
          "--info-border": "var(--border)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
