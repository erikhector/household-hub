"use client";

import { useEffect, useMemo, useState } from "react";
import { ShoppingListClient } from "@/components/shopping/shopping-list-client";
import type { ShoppingListData, ShoppingListDict, ShoppingListItemRow } from "@/components/shopping/shopping-list-types";
import { handwriting } from "@/components/landing/handwriting";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import type { Locale } from "@/lib/i18n/locales";
import { EMPTY_STORE_ORDER } from "@/lib/shopping/store-order";
import { cn } from "@/lib/utils";

type PreviewDict = Dictionary["landing"]["preview"];

// The landing page's product shot, and its one piece of motion. It's the
// product itself: the shopping list's member view (ShoppingListClient, the
// same component the dashboard renders at /dashboard/shopping-list/[id])
// in a phone frame, fed six example rows in its `demo` mode, so it follows
// the visitor's language, theme and unit labels and can't drift from the
// app the way a screenshot or a hand-drawn copy would (UX-58). It's a
// picture, not a control: the frame is one inert `role="img"` with a label
// for screen readers, so nothing inside is focusable, tappable or
// announced, and the two sticky notes beside it are aria-hidden.
//
// The demo. "rest" is the finished picture: oat milk on the list, Sam's
// tick on the bananas, both notes up. That's what the server renders, what
// a visitor with reduced motion keeps, and what a crawler or a thumbnail
// sees, so the page is complete without a single frame of animation. With
// motion allowed, the loop starts after mount: "start" clears the stage,
// then oat milk arrives on the list (a new server row, highlighted the way
// the view highlights one) under its "added itself" note, then the bananas
// tick and glide to "In the cart" (the view's own FLIP move) under Sam's
// note, then it holds and starts over. Each phase holds for `LOOP`'s
// milliseconds. The loop pauses while the tab is hidden and rests on the
// finished picture meanwhile.
type Phase = "rest" | "start" | "added" | "ticked";

const LOOP: ReadonlyArray<readonly [Phase, number]> = [
  ["start", 900],
  ["added", 2400],
  ["ticked", 3800],
];

export function PhonePreview({
  dict,
  listDict,
  autoAddDict,
  barcodeDict,
  exportLabel,
  locale,
  className,
}: {
  dict: PreviewDict;
  listDict: ShoppingListDict;
  autoAddDict: Dictionary["inventory"]["autoAdd"];
  barcodeDict: Dictionary["barcodeScanner"];
  exportLabel: string;
  locale: Locale;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("rest");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: number | undefined;
    let step = 0;
    const run = () => {
      const [next, hold] = LOOP[step % LOOP.length];
      step += 1;
      setPhase(next);
      timer = window.setTimeout(run, hold);
    };
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") run();
      else setPhase("rest");
    };
    run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const oatMilkOnList = phase !== "start";
  const bananasTicked = phase === "rest" || phase === "ticked";

  // One list object per phase: the view reconciles its tick overlay
  // whenever the server rows change identity, so the rows are built once
  // per phase rather than on every render.
  const { list, inventoryItems } = useMemo(() => {
    const now = new Date();
    // The stored categories are the app's own auto-categories in English;
    // the view labels the aisles in the visitor's language (UX-83). Every
    // row is linked to a pantry item, as a household's rows are once the
    // app knows them, so no row asks to be matched.
    const row = (
      id: string,
      name: string,
      quantity: number,
      unit: string,
      category: string,
      extra: Partial<ShoppingListItemRow> = {},
    ): ShoppingListItemRow => ({
      id: `demo-${id}`,
      name,
      quantity,
      unit,
      purchased: false,
      addedAutomatically: false,
      addedByName: null,
      inventoryItemId: `demo-item-${id}`,
      category,
      estimatedPrice: null,
      note: null,
      barcode: null,
      putAwayAt: null,
      priceRecordedAt: null,
      checkedOffAt: null,
      location: null,
      ...extra,
    });
    const bought = { purchased: true, checkedOffAt: now, putAwayAt: now };
    const items = [
      ...(oatMilkOnList ? [row("oat-milk", dict.items.oatMilk, 2, "l", "Dairy & eggs", { addedAutomatically: true })] : []),
      row("yogurt", dict.items.yogurt, 1, "pcs", "Dairy & eggs"),
      row("bananas", dict.items.bananas, 6, "pcs", "Produce", bananasTicked ? bought : {}),
      row("spinach", dict.items.spinach, 1, "bag", "Produce"),
      row("pasta", dict.items.pasta, 500, "g", "Pantry basics"),
      row("coffee", dict.items.coffee, 1, "pcs", "Pantry basics", bought),
    ];
    const list: ShoppingListData = { id: "demo-list", name: dict.listName, status: "ACTIVE", items };
    return {
      list,
      inventoryItems: items.map((item) => ({
        id: item.inventoryItemId!,
        name: item.name,
        category: item.category!,
        unit: item.unit,
      })),
    };
  }, [dict, oatMilkOnList, bananasTicked]);

  return (
    <div className={cn("relative mx-auto w-full max-w-sm", className)} data-phase={phase}>
      {/* The notes sit on the frame's edges (above the speaker slot, and on
          the right edge beside the rows), never over the list name. */}
      <StickyNote shown={oatMilkOnList} className="-top-3 left-0 -rotate-6">
        {dict.addedItself}
      </StickyNote>
      <div
        role="img"
        aria-label={dict.label}
        inert
        className="mx-auto w-80 max-w-full rounded-4xl bg-muted p-2.5 ring-1 ring-foreground/10 select-none"
      >
        {/* The screen is a fixed-height, clipped box, so the list fills it
            like a phone's and the thumb-zone dock (fixed on phones, above a
            bottom bar this frame doesn't have, hence the zeroed
            --bottom-nav-h) pins to the frame's bottom: a transformed
            ancestor is what a fixed descendant positions against. */}
        <div
          className="relative h-[36rem] transform-gpu overflow-hidden rounded-3xl bg-background px-3 pt-2 pb-3 text-left [--bottom-nav-h:0px]"
        >
          {/* The speaker slot, so the frame reads as a phone at a glance. */}
          <span className="mx-auto mb-3 block h-1.5 w-14 rounded-full bg-foreground/15" />
          <ShoppingListClient
            demo
            list={list}
            inventoryItems={inventoryItems}
            smartAddCandidates={[]}
            categories={["Dairy & eggs", "Produce", "Pantry basics"]}
            units={["pcs", "l", "g", "bag"]}
            dict={listDict}
            autoAddDict={autoAddDict}
            barcodeDict={barcodeDict}
            exportLabel={exportLabel}
            locale={locale}
            storeOrder={EMPTY_STORE_ORDER}
          />
        </div>
      </div>
      <StickyNote shown={bananasTicked} className="top-[52%] right-0 rotate-3">
        {dict.tickedBy}
      </StickyNote>
    </div>
  );
}

/** A handwritten sticky note beside the phone; decoration, so aria-hidden. */
function StickyNote({ shown, className, children }: { shown: boolean; className?: string; children: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        handwriting.className,
        "absolute z-40 max-w-[11rem] bg-note-yellow px-3 py-1.5 text-xl leading-tight font-bold text-note-ink shadow-md",
        "transition-[opacity,scale] duration-(--motion-duration-spring) ease-(--motion-ease-spring)",
        shown ? "scale-100 opacity-100" : "scale-75 opacity-0",
        className,
      )}
    >
      {children}
    </span>
  );
}
