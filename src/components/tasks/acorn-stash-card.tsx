"use client";

// Acorn stash: the opt-in chore game's card on the Tasks page, rendered only
// while Household.acornStashEnabled is on (the page passes no rows
// otherwise). One compact row per current member, in join order rather than
// by count: their pile for this week, then their name (with a quiet badge
// when theirs is the week's biggest pile, ties included), and a caption
// with their run of days and all-time total. A run that has ended just
// isn't mentioned: no "streak lost", nothing framed as a loss. The sums
// come from computeAcornStash (src/lib/tasks/acorn-stash.ts) on the server
// and refresh when a tick's save revalidates the page.
//
// `dropKey` goes up each time the person looking ticks a task. A new key
// mounts a fresh acorn over their pile that drops in and fades (globals.css,
// `acorn-drop`), so the reward shows at tap time while the count catches up
// from the server. It is absolutely placed and never takes space, so the
// card doesn't shift, and it isn't rendered under reduced motion. It is
// decoration only: the "Done" toast is the tick's real feedback (M5).

import { Nut } from "lucide-react";
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

export function AcornStashCard({
  rows,
  currentMemberId,
  dropKey,
  dict,
}: {
  rows: AcornStashRow[];
  currentMemberId: string | null;
  dropKey: number;
  dict: Dictionary["tasks"]["acornStash"];
}) {
  return (
    <section
      aria-labelledby="acorn-stash-title"
      className="list-bleed flex flex-col gap-2 rounded-md border bg-card px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="acorn-stash-title" className="flex items-center gap-1.5 font-heading text-base font-semibold">
          <Nut className="size-4 shrink-0 text-primary" aria-hidden="true" />
          {dict.title}
        </h2>
        <p className="text-sm text-muted-foreground">{dict.weekLabel}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const isMe = row.memberId === currentMemberId;
          const caption = [
            row.streak > 0 ? format(plural(row.streak, dict.streak), { count: row.streak }) : null,
            format(dict.allTime, { count: row.allTime }),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={row.memberId} className="flex items-center gap-3">
              <div className="relative flex min-w-12 shrink-0 items-center gap-1">
                <Nut className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="font-heading text-lg leading-none font-semibold tabular-nums" aria-hidden="true">
                  {row.week}
                </span>
                <span className="sr-only">{format(plural(row.week, dict.acornsThisWeek), { count: row.week })}</span>
                {isMe && dropKey > 0 && (
                  <Nut
                    key={dropKey}
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 left-0 size-4 text-primary motion-reduce:hidden motion-safe:animate-acorn-drop"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                  <span className="max-w-full min-w-0 truncate">{isMe ? format(dict.you, { name: row.name }) : row.name}</span>
                  {row.leader && <Badge variant="secondary">{dict.leaderBadge}</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">{caption}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
