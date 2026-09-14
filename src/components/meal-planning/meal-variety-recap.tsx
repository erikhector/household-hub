"use client";

// Small, dismissible recap (see JOY_GAP_BACKLOG.md item 5) — framed as
// variety, not a score, so it never renders for a quiet month rather than
// showing a zero or shaming copy (the caller only renders this component
// when `count > 0`).

import { useState } from "react";
import { Salad, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function MealVarietyRecap({ count, dict }: { count: number; dict: Dictionary["mealPlanning"] }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <Salad className="size-4 shrink-0" />
      <p className="flex-1">{format(plural(count, dict.varietyRecap), { count })}</p>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground"
        aria-label={dict.varietyRecapDismissAriaLabel}
        onClick={() => setDismissed(true)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
