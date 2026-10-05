import * as React from "react"
import { cn } from "cn"

// Plain styled native <input type="radio">, the counterpart of ./checkbox.tsx
// and drawn by hand for the same reason: a native radio can't have a hit
// area bigger than its circle, so on phones the ::after reaches 14px past the
// 20px circle on every side for a 44 x 44 tap target (DESIGN.md rule M3).
// Keep neighbours 8px away from the circle edge.
function Radio({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="radio"
      data-slot="radio"
      className={cn(
        "relative size-4 max-sm:size-5 shrink-0 appearance-none rounded-full border border-input bg-background transition-colors checked:border-primary checked:bg-primary checked:shadow-[inset_0_0_0_3px_var(--background)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:after:absolute max-sm:after:-inset-3.5 max-sm:after:content-[''] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Radio }
