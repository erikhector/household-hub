"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cn } from "cn"
import { Button } from "@/components/ui/button"

// Shared pill-button tab bar used by Budget and Meal Planning's section
// sub-navigation (previously two independently hand-rolled implementations —
// see docs/archive/UX_CONSISTENCY_BACKLOG.md item D). Wraps @base-ui/react's Tabs
// primitive the same way components/ui/select.tsx wraps its Select
// primitive, rather than hand-rolling tab semantics.
//
// UX-23: the bar scrolls sideways instead of wrapping, so a 320 px phone
// never strands the last tab alone on a second row (each Tab is `shrink-0`).
//
// Only renders the tab bar itself — callers keep owning their own tab panel
// markup/visibility (e.g. `hidden` toggling or conditional rendering) exactly
// as before; this component doesn't render `Tabs.Panel`.
export interface TabItem<Value extends string = string> {
  value: Value
  label: React.ReactNode
}

function Tabs<Value extends string = string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabItem<Value>[]
  value: Value
  onChange: (value: Value) => void
  className?: string
}) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(nextValue) => onChange(nextValue as Value)}
      className={cn(
        "flex w-fit min-w-0 max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {/* `contents` keeps the Tab buttons as direct flex items of Root above
          (matching the original single-`<div>` markup) instead of being
          wrapped in an extra flex/box context. */}
      <TabsPrimitive.List className="contents">
        {tabs.map((tab) => (
          <TabsPrimitive.Tab
            key={tab.value}
            value={tab.value}
            render={
              <Button
                type="button"
                variant={tab.value === value ? "secondary" : "ghost"}
                size="sm"
                // UX-25: the secondary fill was 1.03:1 against the muted
                // track, so the active tab was invisible. It renders as a
                // card pill, ringed and lifted off the track, instead — the
                // edge and shadow carry the selection, not the fill.
                className={cn(
                  "shrink-0",
                  tab.value === value &&
                    "border-foreground/10 bg-card text-foreground shadow-sm hover:bg-card hover:text-foreground"
                )}
              />
            }
          >
            {tab.label}
          </TabsPrimitive.Tab>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}

export { Tabs }
