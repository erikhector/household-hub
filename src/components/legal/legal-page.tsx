import type { ReactNode } from "react";
import { STORAGE_INVENTORY } from "@/lib/cookie-inventory";

// Shared pieces of the Terms and Privacy pages, in both languages (UX-66).
// The prose itself lives next to each page (page.tsx for English,
// <page>-sv.tsx for Swedish) so a translator or lawyer can review each
// language as one whole document; only this layout is shared.

export function LegalSection({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-3">
      <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground">
        {children}
      </div>
    </section>
  );
}

export type LegalJumpItem = { id: string; title: string };

// The pages run to several screens, so they open with a list of their
// sections. Each link is a plain in-page anchor (works without JS); the
// LegalSection above carries `scroll-mt` so the heading isn't flush with the
// viewport edge after the jump. `label` is dict.legal.jumpListLabel.
export function LegalJumpList({ label, items }: { label: string; items: LegalJumpItem[] }) {
  return (
    <nav aria-label={label} className="rounded-lg border p-4">
      <p className="mb-1 text-sm font-medium">{label}</p>
      <ul className="flex flex-col text-sm">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="flex min-h-11 items-center text-primary underline underline-offset-4"
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export type CookieListLabels = {
  name: string;
  type: string;
  purpose: string;
  lasts: string;
  cookie: string;
  cache: string;
  localStorage: string;
  necessary: string;
  preference: string;
};

// One card per row of src/lib/cookie-inventory.ts, in the page's language.
export function CookieList({ locale, labels }: { locale: "en" | "sv"; labels: CookieListLabels }) {
  return (
    <ul className="flex flex-col gap-3">
      {STORAGE_INVENTORY.map((entry) => (
        <li key={entry.name} className="rounded-lg border p-3">
          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{labels.name}</dt>
            <dd className="font-mono break-all">{entry.name}</dd>
            <dt className="text-muted-foreground">{labels.type}</dt>
            <dd>
              {entry.kind === "cookie"
                ? labels.cookie
                : entry.kind === "cache"
                  ? labels.cache
                  : labels.localStorage}
              , {entry.category === "necessary" ? labels.necessary : labels.preference}
            </dd>
            <dt className="text-muted-foreground">{labels.purpose}</dt>
            <dd>{locale === "sv" ? entry.purposeSv : entry.purpose}</dd>
            <dt className="text-muted-foreground">{labels.lasts}</dt>
            <dd>{locale === "sv" ? entry.durationSv : entry.duration}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}
