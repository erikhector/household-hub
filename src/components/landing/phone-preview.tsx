"use client";

import { useEffect, useState } from "react";
import { SharedListView, SharedRowView, type SharedListViewDict, type SharedListViewItem } from "@/components/shopping/shared-list-view";
import { handwriting } from "@/components/landing/handwriting";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

type PreviewDict = Dictionary["landing"]["preview"];

// The landing page's product shot, and its one piece of motion. It's the
// real thing: the share page's list view (SharedListView, what a link
// holder sees in the shop) in a phone frame, fed example rows, so it
// follows the visitor's language and theme, and can't drift from the
// product the way a screenshot or a hand-drawn copy would (UX-58). It's a
// picture, not a control: the frame is one inert `role="img"` with a label
// for screen readers, so nothing inside is focusable, tappable or
// announced, and the two sticky notes beside it are aria-hidden.
//
// The demo. "rest" is the finished picture: oat milk on the list, Sam's
// tick on the bananas, both notes up. That's what the server renders, what
// a visitor with reduced motion keeps, and what a crawler or a thumbnail
// sees, so the page is complete without a single frame of animation. With
// motion allowed, the loop starts after mount: "start" clears the stage,
// then oat milk rises onto the list under its "added itself" note, then
// the bananas tick (the checkbox's own tick-pop) and move to "In the cart"
// under Sam's note, then it holds and starts over. Each phase holds for
// `LOOP`'s milliseconds; the moves run on the motion tokens (DESIGN.md,
// "Depth, motion and states"). The loop pauses while the tab is hidden and
// rests on the finished picture meanwhile.
type Phase = "rest" | "start" | "added" | "ticked";

const LOOP: ReadonlyArray<readonly [Phase, number]> = [
  ["start", 900],
  ["added", 2400],
  ["ticked", 3800],
];

// The stored categories are the app's own auto-categories in English;
// SharedListView labels the aisles in the visitor's language (UX-83).
const OAT_MILK = "oat-milk";
const BANANAS = "bananas";

export function PhonePreview({
  dict,
  listDict,
  shoppingMode,
  otherCategory,
  sharedBy,
  locale,
  className,
}: {
  dict: PreviewDict;
  listDict: SharedListViewDict;
  shoppingMode: Dictionary["shoppingList"]["shoppingMode"];
  otherCategory: string;
  /** "Shared by {household}", formatted by the page. */
  sharedBy: string;
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

  const row = (id: string, name: string, quantity: number, unit: string, category: string, purchased = false): SharedListViewItem => ({
    id,
    name,
    quantity,
    unit,
    purchased,
    note: null,
    category,
  });
  const items: SharedListViewItem[] = [
    ...(oatMilkOnList ? [row(OAT_MILK, dict.items.oatMilk, 2, "l", "Dairy & eggs")] : []),
    row("yogurt", dict.items.yogurt, 1, "pcs", "Dairy & eggs"),
    row(BANANAS, dict.items.bananas, 6, "pcs", "Produce", bananasTicked),
    row("spinach", dict.items.spinach, 1, "bag", "Produce"),
    row("pasta", dict.items.pasta, 500, "g", "Pantry basics"),
    row("coffee", dict.items.coffee, 1, "pcs", "Pantry basics", true),
  ];

  return (
    <div className={cn("relative mx-auto w-full max-w-sm", className)} data-phase={phase}>
      {/* The notes sit on the frame's edges (above the speaker slot, and on
          the right edge beside the bananas), never over the list name. */}
      <StickyNote shown={oatMilkOnList} className="-top-3 left-0 -rotate-6">
        {dict.addedItself}
      </StickyNote>
      <div
        role="img"
        aria-label={dict.label}
        inert
        className="mx-auto w-72 max-w-full rounded-4xl bg-muted p-2.5 ring-1 ring-foreground/10 select-none"
      >
        <div className="flex flex-col gap-3 overflow-hidden rounded-3xl bg-background px-3 pt-2 pb-4 text-left">
          {/* The speaker slot, so the frame reads as a phone at a glance. */}
          <span className="mx-auto h-1.5 w-14 rounded-full bg-foreground/15" />
          <SharedListView
            decorative
            name={dict.listName}
            sharedBy={sharedBy}
            items={items}
            otherCategory={otherCategory}
            locale={locale}
            dict={listDict}
            shoppingMode={shoppingMode}
            renderRow={(item) => (
              // Oat milk rises onto the list the way a new row does in the
              // app; the bananas' tick plays the checkbox's own tick-pop.
              <div key={item.id} className={cn(item.id === OAT_MILK && phase === "added" && "motion-safe:animate-landing-rise")}>
                <SharedRowView
                  item={item}
                  purchased={item.purchased}
                  onToggle={() => {}}
                  ticking={item.id === BANANAS && phase === "ticked"}
                />
              </div>
            )}
          />
        </div>
      </div>
      <StickyNote shown={bananasTicked} className="top-[46%] right-0 rotate-3">
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
        "absolute z-10 max-w-[11rem] bg-note-yellow px-3 py-1.5 text-xl leading-tight font-bold text-note-ink shadow-md",
        "transition-[opacity,scale] duration-(--motion-duration-spring) ease-(--motion-ease-spring)",
        shown ? "scale-100 opacity-100" : "scale-75 opacity-0",
        className,
      )}
    >
      {children}
    </span>
  );
}
