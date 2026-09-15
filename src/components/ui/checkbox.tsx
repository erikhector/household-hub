import * as React from "react"
import { cn } from "cn"

// Plain styled native <input type="checkbox"> rather than a Base UI/Radix
// primitive: @base-ui/react does ship a ./checkbox export, but its Checkbox
// exposes onCheckedChange(checked) instead of a native onChange(event), and
// every current call site relies on the native event (e.g. reading
// `e.target.checked` directly). Wrapping the native input keeps every
// existing checked/onChange/disabled wire-up unchanged while still giving
// the control one consistent, on-brand look.
function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Checkbox }
