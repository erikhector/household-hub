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
// as before; this component doesn't render `Tabs.Panel`. A caller that wants
// its panels announced as tabpanels passes `idPrefix` and spreads
// `tabPanelProps(idPrefix, value)` on each panel: Base UI only links a tab to
// a panel it renders itself, and the bar's Root is styled as the pill track,
// so the ids are wired by hand instead.
//
// `size="compact"` is a switch *inside* a card (Insights' Expenses/Income/
// Savings), which must not read as a second row of page tabs: smaller text,
// a 28 px pill (32 px on phones) on a tighter track. The 44 px touch height
// (DESIGN.md M3) comes from a transparent ::after that reaches past the
// pill, so the track mustn't clip it: its overflow stays visible, which a
// three-way switch can afford since it never needs to scroll.
export interface TabItem<Value extends string = string> {
  value: Value
  label: React.ReactNode
}

function tabId(idPrefix: string, value: string) {
  return `${idPrefix}-tab-${value}`
}

function tabPanelId(idPrefix: string, value: string) {
  return `${idPrefix}-panel-${value}`
}

/** The ARIA wiring for the panel of tab `value`, when the bar was given
 * the same `idPrefix`. */
function tabPanelProps(idPrefix: string, value: string) {
  return {
    role: "tabpanel",
    id: tabPanelId(idPrefix, value),
    "aria-labelledby": tabId(idPrefix, value),
  } as const
}

function Tabs<Value extends string = string>({
  tabs,
  value,
  onChange,
  className,
  size = "default",
  idPrefix,
}: {
  tabs: TabItem<Value>[]
  value: Value
  onChange: (value: Value) => void
  className?: string
  size?: "default" | "compact"
  /** Gives each tab an id and `aria-controls`, for `tabPanelProps`. */
  idPrefix?: string
}) {
  const compact = size === "compact"
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={(nextValue) => onChange(nextValue as Value)}
      className={cn(
        "flex w-fit min-w-0 max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        compact && "gap-0.5 overflow-visible p-0.5",
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
            id={idPrefix ? tabId(idPrefix, tab.value) : undefined}
            aria-controls={idPrefix ? tabPanelId(idPrefix, tab.value) : undefined}
            render={
              <Button
                type="button"
                variant={tab.value === value ? "secondary" : "ghost"}
                size={compact ? "xs" : "sm"}
                // UX-25: the secondary fill was 1.03:1 against the muted
                // track, so the active tab was invisible. It renders as a
                // card pill, ringed and lifted off the track, instead — the
                // edge and shadow carry the selection, not the fill.
                className={cn(
                  "shrink-0",
                  compact &&
                    "relative h-7 px-2.5 max-sm:h-8 pointer-coarse:h-8 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
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

export { Tabs, tabPanelProps }
