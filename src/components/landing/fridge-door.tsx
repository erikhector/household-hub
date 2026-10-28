import type { ReactNode } from "react";
import { BrandBadge } from "@/components/brand/brand-badge";
import { handwriting } from "@/components/landing/handwriting";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

type FridgeDict = Dictionary["landing"]["fridge"];

// The landing hero's fridge door: the scribbled shopping list, the chore
// argument, the receipt nobody settled, all stuck up with magnets, and the
// real Squirrel list (PhonePreview, passed in as children) hanging among
// them. Everything here but the phone is decoration, so each note is
// aria-hidden and nothing is focusable; the phone keeps its own role="img"
// and label. The notes are paper in both themes (the note-* tokens don't
// change with .dark); only the door's enamel does.
//
// The door stacks the magnets, then the phone with a note either side
// (from `sm`), then the rest of the notes, so the list is in the first
// screen at any size (e2e/landing.spec.ts checks it).

const note = "relative shadow-md transition-transform duration-200 motion-safe:hover:rotate-0";

/** A coloured magnet holding a note up. */
function Pin({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "absolute -top-3 left-1/2 size-6 -translate-x-1/2 rounded-full shadow-md ring-2 ring-note-ink/15 ring-inset",
        className,
      )}
    />
  );
}

/** A strip of tape across the top of a note. */
function Tape({ className }: { className?: string }) {
  return <span className={cn("absolute -top-2.5 h-5 w-16 bg-note-paper/60", className)} />;
}

export function ShoppingNote({ dict, className }: { dict: FridgeDict["shoppingNote"]; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(note, handwriting.className, "bg-note-paper px-4 pt-6 pb-4 text-[1.4rem] leading-8 text-note-ink", className)}
      style={{
        // Ruled paper: one line per 2rem, matching leading-8.
        backgroundImage:
          "repeating-linear-gradient(var(--note-paper) 0 calc(2rem - 1px), var(--note-line) calc(2rem - 1px) 2rem)",
        backgroundPositionY: "1.5rem",
      }}
    >
      <Pin className="bg-chart-1" />
      <p className="text-[1.65rem] font-bold">{dict.title}</p>
      <p className="line-through decoration-2">{dict.bananas}</p>
      <p>{dict.oatMilk}</p>
      <p>{dict.pasta}</p>
      <p className="line-through decoration-2">{dict.coffee}</p>
      <p>{dict.spinach}</p>
    </div>
  );
}

export function ChoresNote({ dict, className }: { dict: FridgeDict["choresNote"]; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(note, handwriting.className, "bg-note-yellow p-4 pt-5 text-2xl leading-tight text-note-ink", className)}
    >
      <Tape className="left-1/2 -translate-x-1/2 -rotate-3" />
      <p>{dict.title}</p>
      <p className="font-bold">{dict.question}</p>
      <p className="text-xl">{dict.aside}</p>
    </div>
  );
}

export function ReceiptNote({ dict, className }: { dict: FridgeDict["receipt"]; className?: string }) {
  const lines = [dict.items.oatMilk, dict.items.pasta, dict.items.bananas, dict.items.coffee];
  return (
    <div
      aria-hidden="true"
      className={cn(note, "bg-note-paper px-3.5 pt-4 pb-5 font-mono text-xs leading-relaxed text-note-ink uppercase", className)}
      // The torn, zig-zag bottom edge of a till roll.
      style={{
        clipPath:
          "polygon(0 0, 100% 0, 100% 96%, 92% 100%, 84% 96%, 76% 100%, 68% 96%, 60% 100%, 52% 96%, 44% 100%, 36% 96%, 28% 100%, 20% 96%, 12% 100%, 4% 96%, 0 100%)",
      }}
    >
      <p className="text-center">{dict.shop}</p>
      <hr className="my-1.5 border-dashed border-note-ink/40" />
      {lines.map((line) => (
        <p key={line.name} className="flex justify-between gap-3">
          <span>{line.name}</span>
          <span className="tabular-nums">{line.price}</span>
        </p>
      ))}
      <hr className="my-1.5 border-dashed border-note-ink/40" />
      <p className="flex justify-between gap-3 font-medium">
        <span>{dict.total.name}</span>
        <span className="tabular-nums">{dict.total.price}</span>
      </p>
      <p className={cn(handwriting.className, "mt-1 -rotate-3 text-xl normal-case text-note-red")}>{dict.whoPaid}</p>
    </div>
  );
}

function TacoNote({ dict, className }: { dict: FridgeDict["tacoNote"]; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(note, handwriting.className, "bg-note-pink p-3.5 pt-4 text-xl leading-tight text-note-ink", className)}
    >
      <Pin className="left-auto right-3 translate-x-0 bg-chart-3" />
      <p className="font-bold">{dict.title}</p>
      <p>{dict.need}</p>
    </div>
  );
}

function BudgetNote({ dict, className }: { dict: FridgeDict["budgetNote"]; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(note, handwriting.className, "bg-note-green p-3.5 pt-4 text-xl leading-tight text-note-ink", className)}
    >
      <Tape className="left-4 rotate-3" />
      <p>{dict.title}</p>
      <p className="font-bold">{dict.amount}</p>
      <p className="text-lg">{dict.aside}</p>
    </div>
  );
}

// The letter magnets spell the brand. Each letter gets its own tilt and a
// staggered bob; the colours cycle through the chart palette.
const MAGNET_COLOURS = ["text-primary", "text-chart-2", "text-chart-1", "text-chart-3", "text-chart-5"];
const MAGNET_TILTS = [-8, 6, -4, 9, -6, 5, -10, 7];

function Magnets({ word }: { word: string }) {
  return (
    <div aria-hidden="true" className="flex items-center justify-between gap-3">
      <span className="flex flex-wrap gap-0.5">
        {[...word].map((letter, index) => (
          <span
            key={index}
            className={cn(
              "font-heading text-4xl leading-none font-extrabold uppercase select-none sm:text-6xl motion-safe:animate-magnet-bob",
              "[text-shadow:0_3px_0_color-mix(in_oklch,currentColor_55%,var(--note-ink))]",
              MAGNET_COLOURS[index % MAGNET_COLOURS.length],
            )}
            style={{
              rotate: `${MAGNET_TILTS[index % MAGNET_TILTS.length]}deg`,
              animationDelay: `${index * -0.5}s`,
            }}
          >
            {letter}
          </span>
        ))}
      </span>
      <BrandBadge className="size-12 rotate-12 rounded-2xl shadow-md sm:size-16" />
    </div>
  );
}

export function FridgeDoor({ dict, brand, children }: { dict: FridgeDict; brand: string; children: ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-[34rem] shrink-0 lg:mx-0">
      <div className="relative flex flex-col gap-6 rounded-[2.5rem] bg-fridge p-5 ring-1 ring-foreground/10 sm:p-8">
        <Magnets word={brand} />
        <div className="relative flex justify-center">
          <TacoNote dict={dict.tacoNote} className="absolute top-8 left-0 hidden w-36 -rotate-6 sm:block" />
          {children}
          <BudgetNote dict={dict.budgetNote} className="absolute right-0 bottom-8 hidden w-36 rotate-6 sm:block" />
        </div>
        <div className="grid grid-cols-2 items-start gap-5">
          <ShoppingNote dict={dict.shoppingNote} className="-rotate-3" />
          <div className="flex flex-col items-end gap-6 pt-2">
            <ChoresNote dict={dict.choresNote} className="w-full max-w-44 rotate-3" />
            <ReceiptNote dict={dict.receipt} className="hidden w-40 -rotate-2 sm:block" />
          </div>
        </div>
      </div>
      {/* The door handle, down the hinge-free edge. */}
      <span aria-hidden="true" className="absolute top-40 -right-1.5 h-64 w-3 rounded-full bg-fridge-handle" />
    </div>
  );
}
