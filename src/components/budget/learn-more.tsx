import { ChevronDown } from "lucide-react";

// UX-174 (Help: "explain progressively"): a Manage card says what it is in
// one line and keeps the longer explanation behind this disclosure, so the
// page opens on the data instead of on paragraphs. A native <details>, like
// ProfileDisclosure: keyboard and screen-reader support with no JS. The
// summary is a 44 px target (DESIGN.md M3) that hugs its label rather than
// stretching across the card.
export function LearnMore({ label, children }: { label: string; children: string }) {
  return (
    <details className="group">
      <summary className="touch-target inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-sm text-primary [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <p className="pb-1 text-sm text-muted-foreground">{children}</p>
    </details>
  );
}
