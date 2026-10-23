import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// UX-76 (DESIGN.md M6): rare items on the Profile (the version, deleting the
// account) sit behind a disclosure instead of stacking under the settings
// people come for. A native <details>: keyboard and screen-reader support,
// no JS, and the content stays in the DOM so a Client Component inside it
// (the delete dialog) keeps its state. The summary is a full-width 44 px row
// (M3) with the chevron on the right.
export function ProfileDisclosure({
  title,
  tone = "default",
  id,
  defaultOpen = false,
  children,
}: {
  title: string;
  // Anchor target, and (with defaultOpen) how a link from another page
  // lands with the disclosure already expanded (UX-77).
  id?: string;
  defaultOpen?: boolean;
  tone?: "default" | "destructive";
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className={`group list-bleed scroll-mt-4 rounded-md border ${
        tone === "destructive" ? "border-destructive/30 bg-destructive/5" : ""
      }`}
    >
      <summary className="touch-target flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-4 py-3 font-heading text-base font-semibold [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
    </details>
  );
}
