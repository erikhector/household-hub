"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { BrandBadge } from "@/components/brand/brand-badge";
import { badgeVariants } from "@/components/ui/badge";
import { handwriting } from "@/components/landing/handwriting";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

type PreviewDict = Dictionary["landing"]["preview"];

// The landing page's product shot, and its one piece of motion. A shopping
// list in a phone frame, drawn with the app's own tokens and row styling
// (checkbox, "Low stock" badge, the default list's "Fills itself" badge, a
// struck-through "Purchased" row) rather than a screenshot, so it follows
// the visitor's language and theme and never goes stale against a PNG
// nobody re-shoots (UX-58). It's a picture, not a control: one `role="img"`
// with a label for screen readers, nothing inside is focusable or
// tappable, and the two sticky notes beside it are aria-hidden.
//
// The demo. "rest" is the finished picture: oat milk on the list, Sam's
// tick on the bananas, both notes up. That's what the server renders, what
// a visitor with reduced motion keeps, and what a crawler or a thumbnail
// sees, so the page is complete without a single frame of animation. With
// motion allowed, the loop starts after mount: "start" clears the stage,
// then oat milk slides onto the list under its "added itself" note, then
// the bananas tick with Sam's note, then it holds and starts over. Each
// phase holds for `LOOP`'s milliseconds; the moves themselves run on the
// motion tokens (DESIGN.md, "Depth, motion and states"). The loop pauses
// while the tab is hidden and rests on the finished picture meanwhile.
type Phase = "rest" | "start" | "added" | "ticked";

const LOOP: ReadonlyArray<readonly [Phase, number]> = [
  ["start", 900],
  ["added", 2400],
  ["ticked", 3800],
];

export function PhonePreview({ dict, className }: { dict: PreviewDict; className?: string }) {
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

  type Item = { name: string; qty: string; lowStock: boolean; ticked?: boolean };
  const sections: { title: string; items: Item[] }[] = [
    {
      title: dict.sections.dairy,
      items: [{ ...dict.items.yogurt, lowStock: false }],
    },
    {
      title: dict.sections.produce,
      items: [
        { ...dict.items.bananas, lowStock: false, ticked: bananasTicked },
        { ...dict.items.spinach, lowStock: false },
      ],
    },
    {
      title: dict.sections.pantry,
      items: [{ ...dict.items.pasta, lowStock: true }],
    },
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
        className="mx-auto w-72 max-w-full rounded-4xl bg-muted p-2.5 ring-1 ring-foreground/10 select-none"
      >
        <div className="flex flex-col gap-3 overflow-hidden rounded-3xl bg-background px-3 pt-2 pb-4 text-left">
          {/* The speaker slot, so the frame reads as a phone at a glance. */}
          <span className="mx-auto h-1.5 w-14 rounded-full bg-foreground/15" />
          <div className="flex items-center gap-2">
            <BrandBadge className="size-8 rounded-lg" />
            <span className="min-w-0 flex-1 font-heading text-base leading-tight font-bold break-words">
              {dict.listName}
            </span>
            <span className={badgeVariants({ variant: "secondary" })}>{dict.fillsItself}</span>
          </div>
          {sections.map((section) => (
            <div key={section.title} className="flex flex-col gap-1">
              <span className="px-1 text-xs font-semibold text-muted-foreground">{section.title}</span>
              <div className="flex flex-col rounded-xl bg-card px-3 py-1 ring-1 ring-foreground/10">
                {section.title === dict.sections.dairy && (
                  // Oat milk arrives as a row that grows from nothing, the
                  // way a low-stock item lands on the real list.
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows,opacity] duration-(--motion-duration-spring) ease-(--motion-ease-spring)",
                      oatMilkOnList ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <Row name={dict.items.oatMilk.name} qty={dict.items.oatMilk.qty} badge={dict.lowStock} />
                    </div>
                  </div>
                )}
                {section.items.map((item) => (
                  <Row
                    key={item.name}
                    name={item.name}
                    qty={item.qty}
                    badge={item.lowStock ? dict.lowStock : undefined}
                    ticked={item.ticked}
                    popping={item.ticked && phase === "ticked"}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <span className="px-1 text-xs font-semibold text-muted-foreground">{dict.purchased}</span>
            <div className="rounded-xl bg-card px-3 py-1 ring-1 ring-foreground/10">
              <Row name={dict.items.coffee.name} ticked />
            </div>
          </div>
        </div>
      </div>
      <StickyNote shown={bananasTicked} className="top-[46%] right-0 rotate-3">
        {dict.tickedBy}
      </StickyNote>
    </div>
  );
}

function Row({
  name,
  qty,
  badge,
  ticked = false,
  popping = false,
}: {
  name: string;
  qty?: string;
  badge?: string;
  ticked?: boolean;
  popping?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 text-sm">
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-(--motion-duration-base)",
          ticked ? "border-primary bg-primary text-primary-foreground" : "border-input",
          popping && "motion-safe:animate-tick-pop",
        )}
      >
        {ticked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate transition-colors duration-(--motion-duration-base)",
          ticked && "text-muted-foreground line-through",
        )}
      >
        {name}
        {qty && <span className="text-muted-foreground"> · {qty}</span>}
      </span>
      {badge && <span className={badgeVariants({ variant: "secondary" })}>{badge}</span>}
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
