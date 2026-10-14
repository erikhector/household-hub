import type { ReactNode } from "react";

// UX-42: a button whose label swaps to "Saving…" while its action runs used
// to resize with the text, nudging every neighbour (and the thumb's target)
// the moment it was tapped. Both labels share one grid cell, so the cell is
// as wide as the longer of the two and only the active one is visible. The
// hidden one is `invisible` (not `display: none`), so it keeps its width but
// is out of the accessibility tree: a screen reader and a role+name locator
// only ever see the label that is showing.
export function PendingLabel({ pending, idle, busy }: { pending: boolean; idle: ReactNode; busy: ReactNode }) {
  return (
    <span className="inline-grid">
      <span className={pending ? "invisible [grid-area:1/1]" : "[grid-area:1/1]"}>{idle}</span>
      <span className={pending ? "[grid-area:1/1]" : "invisible [grid-area:1/1]"}>{busy}</span>
    </span>
  );
}
