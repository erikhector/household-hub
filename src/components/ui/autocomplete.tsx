"use client"

import * as React from "react"
import {
  Autocomplete as AutocompletePrimitive,
  type AutocompleteInputGroupProps,
  type AutocompleteInputProps,
  type AutocompleteTriggerProps,
  type AutocompleteClearProps,
  type AutocompletePopupProps,
  type AutocompletePositionerProps,
  type AutocompleteListProps,
  type AutocompleteItemProps,
  type AutocompleteEmptyProps,
} from "@base-ui/react/autocomplete"
import { cn } from "cn"
import { ChevronsUpDownIcon, XIcon } from "lucide-react"

// A free-text field with suggestions drawn from existing values (see
// select.tsx / combobox.tsx for fixed-list pickers instead). Built on Base
// UI's Autocomplete rather than its Combobox because Combobox doesn't
// support typing a value that isn't in the list — see
// node_modules/@base-ui/react/docs/react/components/autocomplete.md.

const Autocomplete = AutocompletePrimitive.Root

function AutocompleteInputGroup({
  className,
  ...props
}: AutocompleteInputGroupProps) {
  return (
    <AutocompletePrimitive.InputGroup
      data-slot="autocomplete-input-group"
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-1 rounded-lg border-2 border-input bg-transparent py-1 pr-1 pl-2.5 transition-colors has-[input:hover]:border-ring/40 has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

function AutocompleteInput({ className, ...props }: AutocompleteInputProps) {
  return (
    <AutocompletePrimitive.Input
      data-slot="autocomplete-input"
      className={cn(
        "h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

function AutocompleteTrigger({
  className,
  ...props
}: AutocompleteTriggerProps) {
  return (
    <AutocompletePrimitive.Trigger
      data-slot="autocomplete-trigger"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      <ChevronsUpDownIcon className="size-4" />
    </AutocompletePrimitive.Trigger>
  )
}

function AutocompleteClear({ className, ...props }: AutocompleteClearProps) {
  return (
    <AutocompletePrimitive.Clear
      data-slot="autocomplete-clear"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground",
        className
      )}
      {...props}
    >
      <XIcon className="size-3.5" />
    </AutocompletePrimitive.Clear>
  )
}

function AutocompleteContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  ...props
}: AutocompletePopupProps &
  Pick<AutocompletePositionerProps, "align" | "side" | "sideOffset">) {
  return (
    <AutocompletePrimitive.Portal>
      <AutocompletePrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className="isolate z-50"
      >
        <AutocompletePrimitive.Popup
          data-slot="autocomplete-content"
          className={cn(
            "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </AutocompletePrimitive.Popup>
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  )
}

function AutocompleteList({ className, ...props }: AutocompleteListProps) {
  return (
    <AutocompletePrimitive.List
      data-slot="autocomplete-list"
      className={cn("flex flex-col gap-0.5 p-1", className)}
      {...props}
    />
  )
}

function AutocompleteItem({ className, ...props }: AutocompleteItemProps) {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      className={cn(
        "flex w-full cursor-default items-center rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function AutocompleteEmpty({ className, ...props }: AutocompleteEmptyProps) {
  return (
    <AutocompletePrimitive.Empty
      data-slot="autocomplete-empty"
      className={cn(
        "px-2 py-1.5 text-sm text-muted-foreground empty:m-0 empty:p-0",
        className
      )}
      {...props}
    />
  )
}

export {
  Autocomplete,
  AutocompleteInputGroup,
  AutocompleteInput,
  AutocompleteTrigger,
  AutocompleteClear,
  AutocompleteContent,
  AutocompleteList,
  AutocompleteItem,
  AutocompleteEmpty,
}
