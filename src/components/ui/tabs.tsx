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
// UX-170: a track that can scroll fades out at the edge(s) with more tabs
// behind it (a mask, so it works on any background), and the active tab is
// scrolled into view on mount, so "Coo" / "Insi" clipped at 320 px or 200 %
// text reads as "more this way" instead of as a cut-off label. The fade
// state is mirrored in `data-fade` ("start" | "end" | "both" | absent) for
// tests. The compact switch doesn't scroll (overflow-visible), so it's left
// alone.
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
// Savings), which must not read as a second row of page tabs: smaller text
// and a 28 px pill on a tighter track. On phones and touch screens it keeps
// the button's own 44 px height (DESIGN.md M3): a shorter pill with a hit
// area stretched past it measured 32 px in the touch-target check, and the
// smaller text and track already set it apart from the page tabs.
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

// Wide enough to cover a clipped label, narrow enough to leave a whole tab
// readable.
const FADE_PX = 24

type Fade = "start" | "end" | "both" | null

function fadeMask(fade: Fade): React.CSSProperties | undefined {
  if (!fade) return undefined
  const left = fade === "start" || fade === "both" ? `transparent, #000 ${FADE_PX}px` : "#000, #000"
  const right = fade === "end" || fade === "both" ? `#000 calc(100% - ${FADE_PX}px), transparent` : "#000, #000"
  const image = `linear-gradient(to right, ${left}, ${right})`
  return { maskImage: image, WebkitMaskImage: image }
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
  const trackRef = React.useRef<HTMLDivElement>(null)
  const [fade, setFade] = React.useState<Fade>(null)

  // Scroll the active tab into view once on mount. Done on the track's own
  // scrollLeft rather than `scrollIntoView`, which would also scroll the
  // page vertically.
  React.useLayoutEffect(() => {
    const track = trackRef.current
    if (!track || compact) return
    const active = track.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (active) {
      const room = (track.clientWidth - active.offsetWidth) / 2
      track.scrollLeft = Math.max(0, active.offsetLeft - room)
    }
  }, [compact])

  React.useEffect(() => {
    const track = trackRef.current
    if (!track || compact) return
    const update = () => {
      const max = track.scrollWidth - track.clientWidth
      const atStart = track.scrollLeft <= 1
      const atEnd = track.scrollLeft >= max - 1
      setFade(max <= 1 ? null : atStart ? "end" : atEnd ? "start" : "both")
    }
    update()
    track.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(track)
    return () => {
      track.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [compact, tabs.length])

  return (
    <TabsPrimitive.Root
      ref={trackRef}
      data-fade={fade ?? undefined}
      style={fadeMask(fade)}
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
                    "h-7 px-2.5",
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
