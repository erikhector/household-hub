"use client"

import * as React from "react"
import { SearchIcon, XIcon } from "lucide-react"
import { cn } from "cn"
import { Input } from "@/components/ui/input"

// A type="search" Input with a leading search icon and a trailing clear
// ("x") button that appears once there's text — the "clearable input" the
// rest of the app's search/filter fields should reach for. Browsers already
// draw their own search-cancel button for type="search", so we hide it
// ([&::-webkit-search-cancel-button]) rather than show two.

type SearchInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  value: string
  onValueChange: (value: string) => void
  clearLabel: string
  containerClassName?: string
}

function SearchInput({
  value,
  onValueChange,
  clearLabel,
  className,
  containerClassName,
  ...props
}: SearchInputProps) {
  return (
    <div className={cn("relative", containerClassName)}>
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          "pl-8 [&::-webkit-search-cancel-button]:appearance-none",
          value && "pr-8 max-sm:pr-11",
          className
        )}
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => onValueChange("")}
          aria-label={clearLabel}
          className="absolute right-1 top-1/2 flex size-6 max-sm:size-11 max-sm:right-0 -translate-y-1/2 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export { SearchInput }
