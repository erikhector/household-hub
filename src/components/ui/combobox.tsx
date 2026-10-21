"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"

// A filterable alternative to `Select` (see select.tsx) for pickers with a
// long option list. Base UI's own guidance is to prefer Combobox over
// Select once there are enough items to warrant filtering — see
// node_modules/@base-ui/react/docs/react/components/combobox.md, "Usage
// guidelines". Styled to match Select/Popover/Dialog's visual language.

const Combobox = ComboboxPrimitive.Root

const createComboboxItems = ComboboxPrimitive.createItems

function ComboboxInputGroup({
  className,
  ...props
}: ComboboxPrimitive.InputGroup.Props) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      className={cn(
        "flex h-8 max-sm:h-11 pointer-coarse:h-11 w-full items-center gap-1 rounded-lg border border-input bg-transparent pr-1 pl-2.5 text-base transition-colors md:pointer-fine:text-sm outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/13 dark:hover:bg-input/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "h-full max-sm:h-11 pointer-coarse:h-11 min-w-0 flex-1 bg-transparent text-base outline-none md:pointer-fine:text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "flex h-full shrink-0 items-center justify-center rounded-md px-1 max-sm:min-w-11 pointer-coarse:min-w-11 text-muted-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children ?? <ChevronDownIcon />}
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxClear({ className, children, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      className={cn(
        "flex h-full shrink-0 items-center justify-center rounded-md px-1 max-sm:min-w-11 pointer-coarse:min-w-11 text-muted-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children ?? <XIcon />}
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxContent({
  className,
  children,
  emptyMessage,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  ...props
}: Omit<ComboboxPrimitive.Popup.Props, "children"> &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    children: ComboboxPrimitive.List.Props["children"]
    /** Rendered by `Combobox.Empty` when no item matches the filter query.
     * Always mounted (per Base UI's guidance for the Empty part) — pass a
     * translated string via the caller's `dict` prop. */
    emptyMessage?: React.ReactNode
  }) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {emptyMessage !== undefined && (
            <ComboboxPrimitive.Empty className="px-2.5 py-3 text-sm text-muted-foreground">
              {emptyMessage}
            </ComboboxPrimitive.Empty>
          )}
          <ComboboxPrimitive.List className="scroll-my-1 p-1">
            {children}
          </ComboboxPrimitive.List>
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

// UX-96: the list without a popup, for a picker that sits in a bottom sheet
// where a popup anchored under the field gets the sliver of screen between
// the field and the sheet's edge (about 1.5 rows). Used with
// `<Combobox inline open>`: the list is part of the form, about five rows
// tall before it scrolls.
function ComboboxInlineList({
  className,
  children,
  emptyMessage,
}: {
  className?: string
  children: ComboboxPrimitive.List.Props["children"]
  emptyMessage: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-input">
      <ComboboxPrimitive.Empty className="px-2.5 text-sm text-muted-foreground not-empty:py-3">
        {emptyMessage}
      </ComboboxPrimitive.Empty>
      <ComboboxPrimitive.List
        data-slot="combobox-inline-list"
        className={cn("max-h-60 overflow-y-auto p-1 empty:hidden", className)}
      >
        {children}
      </ComboboxPrimitive.List>
    </div>
  )
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 max-sm:min-h-11 pointer-coarse:min-h-11 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">{children}</span>
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

export {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxInlineList,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxTrigger,
  createComboboxItems,
}
