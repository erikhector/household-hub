"use client";

// Acorn stash: the opt-in chore game's card on the Tasks page, rendered only
// while Household.acornStashEnabled is on (the page passes no rows
// otherwise). The sums come from loadAcornStash (src/lib/tasks/acorn-stash.ts)
// on the server and refresh when a tick's save revalidates the page.
//
// DESIGN.md M6: the open tasks are the page's job and the game is secondary,
// so the card sits below them (TasksClient) and is a native <details>,
// collapsed by default, like the Profile's rare items (ProfileDisclosure):
// keyboard and screen-reader support with no JS, and a full-width 44 px
// summary row (M3). Collapsed it is one row: the title and the viewer's own
// pile for this week. Opened, one compact row per current member, in join
// order rather than by count: their pile, then their name (with a quiet
// badge when theirs is the week's biggest pile, ties included), and a
// caption with their run of days and all-time total. A run that has ended
// just isn't mentioned: no "streak lost", nothing framed as a loss.
//
// M5: nothing moves under the thumb when a tick lands. The name line never
// wraps (the name truncates, the badge keeps its width), so the leader badge
// appearing after a tick doesn't add a line, and the drop below takes no
// space.
//
// `dropKey` goes up each time the person looking ticks a task. A new key
// mounts a fresh acorn over their pile on the summary row that drops in and
// fades (globals.css, `acorn-drop-*`), so the reward shows at tap time,
// collapsed or not, while the count catches up from the server. It is
// absolutely placed, and isn't rendered under reduced motion. It is
// decoration only: the "Done" toast is the tick's real feedback (M5).

import type { ReactNode } from "react";
import { ChevronDown, Nut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type AcornStashRow = {
  memberId: string;
  name: string;
  week: number;
  allTime: number;
  streak: number;
  leader: boolean;
};

type StashDict = Dictionary["tasks"]["acornStash"];

// A pile: the acorn, the visible count (hidden from screen readers) and,
// separately, the sentence a screen reader reads instead. Separate elements
// with a space between, so the page's text never runs the digit into the
// sentence ("33 acorns" for 3).
function Pile({ count, label, children }: { count: number; label: string; children?: ReactNode }) {
  return (
    <span className="relative flex min-w-12 shrink-0 items-center gap-1">
      <Nut className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="font-heading text-lg leading-none font-semibold tabular-nums" aria-hidden="true">
        {count}
      </span>{" "}
      <span className="sr-only">{label}</span>
      {children}
    </span>
  );
}

export function AcornStashCard({
  rows,
  currentMemberId,
  dropKey,
  dict,
}: {
  rows: AcornStashRow[];
  currentMemberId: string | null;
  dropKey: number;
  dict: StashDict;
}) {
  const mine = rows.find((row) => row.memberId === currentMemberId);
  return (
    <section
      aria-labelledby="acorn-stash-title"
      data-flip-key="acorn-stash"
      className="list-bleed mt-2 rounded-md border bg-card"
    >
      <details className="group">
        <summary className="touch-target flex cursor-pointer list-none items-center gap-3 rounded-md px-3 py-3 [&::-webkit-details-marker]:hidden">
          <span id="acorn-stash-title" className="flex min-w-0 flex-1 items-center gap-1.5 font-heading text-base font-semibold">
            <Nut className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{dict.title}</span>
          </span>
          {mine && (
            <Pile count={mine.week} label={format(plural(mine.week, dict.yourPile), { count: mine.week })}>
              {dropKey > 0 && (
                <Nut
                  key={dropKey}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 left-0 size-4 text-primary motion-reduce:hidden motion-safe:animate-acorn-drop"
                />
              )}
            </Pile>
          )}
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="flex flex-col gap-2 border-t px-3 py-2.5">
          <p className="text-sm text-muted-foreground">{dict.weekLabel}</p>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const isMe = row.memberId === currentMemberId;
              const name = isMe ? format(dict.you, { name: row.name }) : row.name;
              const caption = [
                row.streak > 0 ? format(plural(row.streak, dict.streak), { count: row.streak }) : null,
                format(dict.allTime, { count: row.allTime }),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={row.memberId} className="flex items-center gap-3">
                  <Pile count={row.week} label={format(plural(row.week, dict.acornsThisWeek), { count: row.week })} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="min-w-0 truncate" title={name}>
                        {name}
                      </span>
                      {row.leader && <Badge variant="secondary">{dict.leaderBadge}</Badge>}
                    </p>
                    <p className="text-sm text-muted-foreground">{caption}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </details>
    </section>
  );
}
