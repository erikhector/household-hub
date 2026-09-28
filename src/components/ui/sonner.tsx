"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

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
