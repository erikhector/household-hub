"use client";

// Budget redesign (Oct 2026): Insights' "This month" shows one breakdown at a
// time — spending, income or savings — behind the shared pill tabs, instead
// of four stat cards (repeating Safe to spend) over three breakdown cards
// stacked one under another on a phone (DESIGN.md M6). Spending comes first:
// "where did the money go?" is what people open Insights for.
//
// The panels are Server Components the caller renders ahead of time (see
// budget-tabs.tsx's doc comment for the pattern); `hidden` keeps all three
// mounted so switching doesn't re-render them.

import { useState, type ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";

export type BreakdownKind = "expense" | "income" | "savings";

export function BreakdownSwitch({
  panels,
}: {
  panels: { value: BreakdownKind; label: string; content: ReactNode }[];
}) {
  const [value, setValue] = useState<BreakdownKind>(panels[0]?.value ?? "expense");
  return (
    <div className="flex flex-col gap-3">
      <Tabs
        tabs={panels.map(({ value, label }) => ({ value, label }))}
        value={value}
        onChange={setValue}
      />
      {panels.map((panel) => (
        <div key={panel.value} hidden={panel.value !== value}>
          {panel.content}
        </div>
      ))}
    </div>
  );
}
