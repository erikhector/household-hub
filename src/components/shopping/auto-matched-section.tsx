"use client";

// The collapsed "N items matched" block both receipt dialogs show above the
// lines that still need a look (AUTO-11, src/lib/shopping/receipt-match.ts).
// Collapsed by default because the whole point is a shorter review, but
// the rows inside are the same editable rows as everywhere else — expanding
// is how a user checks or corrects an auto-accepted match before Apply.
// Nothing here writes anything; it's only a disclosure around children.

import { useId, type ReactNode } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AutoMatchedSection({
  summary,
  expanded,
  onExpandedChange,
  showLabel,
  hideLabel,
  children,
}: {
  /** Already-formatted "12 items matched" text. */
  summary: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  showLabel: string;
  hideLabel: string;
  children: ReactNode;
}) {
  const contentId = useId();
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
          {summary}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? hideLabel : showLabel}
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden />
        </Button>
      </div>
      {expanded && (
        <div id={contentId} className="flex flex-col gap-2">
          {children}
        </div>
      )}
    </div>
  );
}
