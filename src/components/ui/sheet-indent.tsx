"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"

// UX-34: the iOS-style presentation behind a bottom sheet. While any dialog
// is open (every Dialog is a Base UI Drawer, see dialog.tsx), the page shrinks
// a little, drops from the top and rounds its corners over a black ground, so
// the sheet reads as a layer on top of the page rather than part of it. It
// follows the drag: Base UI writes the sheet's dismiss progress (0 → 1) to
// --drawer-swipe-progress, and the page grows back as the sheet is pulled
// down. The transition switches off while that progress is non-zero (the
// --indent-transition clamp, as in Base UI's own demo), or the page would lag
// behind the finger.
//
// Phones only (max-sm): from `sm` dialogs are centred modals. Not at all
// under prefers-reduced-motion: the page stays put.
//
// The transform is only set while active. At rest the wrapper has no
// transform, so the dashboard's position: fixed bottom bar stays relative to
// the viewport (any transform, even scale(1), would make this wrapper its
// containing block). The scale itself is fine for it: the wrapper is the
// screen's size on a phone, so the bar shrinks with the page, as on iOS.
//
// The wrapper carries the page gradient while active, since the black
// ground would otherwise show through the transparent wrapper.
export function SheetIndent({ children }: { children: React.ReactNode }) {
  return (
    <DrawerPrimitive.Provider>
      <DrawerPrimitive.IndentBackground
        data-slot="sheet-indent-background"
        className="pointer-events-none fixed inset-0 -z-10 bg-black opacity-0 sm:hidden max-sm:data-active:opacity-100 motion-reduce:hidden"
      />
      <DrawerPrimitive.Indent
        data-slot="sheet-indent"
        className="flex flex-1 flex-col origin-[center_top] [--indent-transition:calc(1-clamp(0,calc(var(--drawer-swipe-progress)*100000),1))] [transition:transform_calc(400ms*var(--indent-transition))_cubic-bezier(0.32,0.72,0,1),border-radius_calc(250ms*var(--indent-transition))_cubic-bezier(0.32,0.72,0,1)] max-sm:data-active:overflow-hidden max-sm:data-active:rounded-t-[calc(1rem*(1-var(--drawer-swipe-progress)))] max-sm:data-active:[background:radial-gradient(circle,var(--gradient-start),var(--gradient-end))] max-sm:data-active:[transform:scale(calc(0.94+0.06*var(--drawer-swipe-progress)))_translateY(calc((env(safe-area-inset-top)+0.75rem)*(1-var(--drawer-swipe-progress))))] motion-reduce:transition-none motion-reduce:transform-none!"
      >
        {children}
      </DrawerPrimitive.Indent>
    </DrawerPrimitive.Provider>
  )
}
