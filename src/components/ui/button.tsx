import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { isValidElement } from "react"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex max-sm:min-w-11 pointer-coarse:min-w-11 shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none hover:-translate-y-0.5 active:not-aria-[haspopup]:translate-y-px active:not-aria-[haspopup]:scale-[0.98] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // UX-25: a solid fill at 50% opacity over the page composites to a
        // pale wash, and white on it was ~1.5:1. Disabled solid buttons keep
        // their shape at full opacity on a muted fill instead
        // (muted-foreground on muted is guarded in globals-contrast.test.ts).
        default:
          "bg-primary text-primary-foreground shadow-sm shadow-primary/30 hover:bg-primary/85 hover:shadow-md hover:shadow-primary/40 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:opacity-100",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/13 dark:hover:bg-input/20",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // The max-sm:* and pointer-coarse:* bumps widen touch targets to 44px on phones and touch screens (where
        // the primary input is a finger, not a mouse, even on a tablet or a phone in
        // landscape wider than sm; DESIGN.md rule M3)
        // without changing the denser desktop sizing these were originally
        // tuned for. e2e/ui.ts `expectTouchTargets` guards it.
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 max-sm:h-11 pointer-coarse:h-11",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3 max-sm:h-11 pointer-coarse:h-11",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5 max-sm:h-11 pointer-coarse:h-11",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 max-sm:h-11 pointer-coarse:h-11",
        icon: "size-8 max-sm:size-11 pointer-coarse:size-11",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3 max-sm:size-11 pointer-coarse:size-11",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg max-sm:size-11 pointer-coarse:size-11",
        "icon-lg": "size-9 max-sm:size-11 pointer-coarse:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// UX-68: Base UI stamps role="button" on any non-native render target, so a
// Button rendered as a Link announced "button" for something that navigates.
// A render element carrying an href is a link; say so (a `role` passed at the
// call site still wins, since props are spread last).
function isLinkRender(render: ButtonPrimitive.Props["render"]) {
  return (
    isValidElement<{ href?: unknown }>(render) &&
    render.props.href !== undefined
  )
}

function Button({
  className,
  variant = "default",
  size = "default",
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      // Most `render` usage here swaps in a non-<button> element (a Next.js
      // Link, most often), which isn't a native button — default
      // nativeButton to false in that case so Base UI doesn't warn about
      // missing native-button semantics on it. Still overridable per call
      // site (e.g. rendering onto an actual <button>).
      nativeButton={nativeButton ?? !render}
      render={render}
      {...(isLinkRender(render) ? { role: "link" } : null)}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
