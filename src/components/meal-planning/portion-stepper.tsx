"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

// GAP-49: a −/+ stepper around a read-only count, for portions — picking
// beats typing on a phone (DESIGN.md M4), and the buttons are the `icon`
// size, which grows to 44 px on touch (M3). The count itself is an
// <output>, so a screen reader announces the new value after each tap; the
// owning form submits it through its own hidden input.
export function PortionStepper({
  value,
  min,
  max,
  onChange,
  label,
  decreaseLabel,
  increaseLabel,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Names the group and the count, e.g. "Portions". */
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={decreaseLabel}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus />
      </Button>
      <output aria-live="polite" aria-label={label} className="min-w-8 text-center text-base font-semibold tabular-nums">
        {value}
      </output>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={increaseLabel}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus />
      </Button>
    </div>
  );
}
