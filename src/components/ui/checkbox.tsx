import * as React from "react"
import { cn } from "cn"

// Plain styled native <input type="checkbox"> rather than a Base UI/Radix
// primitive: @base-ui/react does ship a ./checkbox export, but its Checkbox
// exposes onCheckedChange(checked) instead of a native onChange(event), and
// every current call site relies on the native event (e.g. reading
// `e.target.checked` directly). Wrapping the native input keeps every
// existing checked/onChange/disabled wire-up unchanged while still giving
// the control one consistent, on-brand look.
//
// It is drawn by hand (appearance-none) rather than left to the browser
// because a native checkbox can't have a hit area bigger than its box. On
// phones the ::after reaches 14px past the 20px box on every side, so the
// tap target is 44 x 44 (DESIGN.md rule M3) while the box stays compact.
// Pseudo-elements on the input itself are hit-tested as the input, so a
// tap on the halo toggles it. Keep neighbours 8px away from the box edge.
//
// The tick lives in globals.css (`checkbox-tick`), not in an arbitrary
// background-image class here: the SVG's spaces split it into several
// "classes", so cn() read a fragment as a background colour and dropped
// `checked:bg-primary`, and a checked box rendered as an empty outline with
// no fill and no tick.
function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "relative size-4 max-sm:size-5 shrink-0 appearance-none rounded-[5px] border border-input bg-background bg-center bg-no-repeat transition-colors checked:border-primary checked:bg-primary checked:bg-[length:80%] checked:checkbox-tick focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:after:absolute max-sm:after:-inset-3.5 max-sm:after:content-[''] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Checkbox }
