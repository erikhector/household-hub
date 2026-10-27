"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

// Thin wrapper over Base UI's Tooltip, for icon-only controls (the collapsed
// sidebar, UX-27). A hover/focus hint for mouse and keyboard users: it is
// NOT the accessible name. A native `title` never shows on touch, and this
// doesn't either (hidden on touch screens, UX-41d), so the control must also carry an `aria-label`.
//
// `render` is the element that becomes the trigger (a Link, a Button, or a
// DropdownMenuTrigger that itself renders a Button), so the tooltip adds no
// wrapper element to the layout. `disabled` lets a caller keep one markup
// shape and just switch the hint off (the expanded sidebar already shows the
// label as text).
function Tooltip({
  label,
  disabled,
  render,
  children,
  side = "right",
}: {
  label: React.ReactNode
  disabled?: boolean
  render: React.ReactElement
  children: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <TooltipPrimitive.Root disabled={disabled}>
      <TooltipPrimitive.Trigger render={render}>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={8} className="z-50">
          <TooltipPrimitive.Popup className="pointer-coarse:hidden rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md">
            {label}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export { Tooltip }
