"use client";

// UX-70: the overview's "what needs me now?" block, first on the page. On a
// phone the first screen used to be a greeting, the setup card and two
// cards, with tasks as plain text you couldn't tick and no sign of tonight's
// dinner, the household budget or what's about to expire. Now it holds
//
// - the open tasks that are yours or nobody's, each with a tick that saves
//   in the background (the same optimistic pattern as the task list: the
//   row shows ticked at tap time and goes back, with a toast, if the save
//   fails; it stays in place, struck through, so nothing jumps under the
//   thumb, M5);
// - one row per fact below, each a link to where you act on it: tonight's
//   dinner, the household's safe to spend (only once the budget has
//   categories) and the count of items expiring soon (only when above 0).
//
// Everything is worked out on the server (src/app/dashboard/page.tsx) and
// passed in as plain values; this component only owns the ticks.

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronRight, Snowflake, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toggleTaskCompletedAction } from "@/app/dashboard/tasks/actions";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { SafeToSpendStatus } from "@/lib/safe-to-spend-calc";

export type TodayTask = {
  id: string;
  title: string;
  /** Nobody is assigned: shown with a hint, since it's the household's. */
  unassigned: boolean;
};

const STATUS_COLOR: Record<SafeToSpendStatus, string> = {
  healthy: "text-success",
  tight: "text-warning",
  over: "text-destructive",
};

// Rows that link somewhere keep a 44 px target on phones (M3).
const FACT_ROW =
  "flex min-h-9 items-center gap-3 rounded-md px-1 text-sm hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-sm:min-h-11 pointer-coarse:min-h-11";

export function TodayBlock({
  tasks,
  moreTaskCount,
  tonight,
  safeToSpend,
  expiringCount,
  dict,
  taskDict,
}: {
  tasks: TodayTask[];
  /** Open tasks beyond the ones listed. */
  moreTaskCount: number;
  /** Tonight's planned dinner(s), already named; empty when nothing is planned. */
  tonight: string[];
  /** Null until the household budget has categories. */
  safeToSpend: { formatted: string; status: SafeToSpendStatus } | null;
  expiringCount: number;
  dict: Dictionary["dashboard"]["today"];
  taskDict: Pick<Dictionary["tasks"], "toggleCompleteAriaLabel" | "toggleIncompleteAriaLabel" | "doneToast"> & {
    undo: string;
    saveFailedToast: string;
  };
}) {
  // What this visit has ticked, by task id. The server list only changes on
  // the next visit, so a ticked row stays (struck through) until then.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (task: TodayTask, completing: boolean) => {
    const set = (done: boolean) =>
      setTicked((current) => {
        const next = new Set(current);
        if (done) next.add(task.id);
        else next.delete(task.id);
        return next;
      });
    set(completing);
    if (completing) {
      // Undo is the same toggle, from the state this tick left behind.
      toast(format(taskDict.doneToast, { title: task.title }), {
        duration: 5000,
        action: { label: taskDict.undo, onClick: () => toggle(task, false) },
      });
    }
    void (async () => {
      const result = await settleOptimisticAction(() => toggleTaskCompletedAction(task.id), taskDict.saveFailedToast);
      if (result === null) set(!completing);
    })();
  };

  const tonightText = tonight.length > 0 ? tonight.join(", ") : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-heading text-base font-semibold text-foreground">{dict.title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {tasks.length > 0 ? (
          <ul className="flex flex-col gap-1" aria-label={dict.tasksAriaLabel}>
            {tasks.map((task) => {
              const done = ticked.has(task.id);
              return (
                <li key={task.id} className="flex items-center gap-3 px-1 max-sm:min-h-11">
                  <Checkbox
                    checked={done}
                    aria-label={format(
                      done ? taskDict.toggleIncompleteAriaLabel : taskDict.toggleCompleteAriaLabel,
                      { title: task.title },
                    )}
                    onChange={() => toggle(task, !done)}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={`line-clamp-2 break-words text-sm ${done ? "text-muted-foreground line-through" : ""}`}
                    >
                      {task.title}
                    </span>
                    {task.unassigned && <span className="text-xs text-muted-foreground">{dict.unassigned}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{dict.noTasks}</p>
        )}
        <Link
          href="/dashboard/tasks"
          className="touch-target inline-flex items-center gap-1 self-start text-sm underline underline-offset-4"
        >
          {moreTaskCount > 0
            ? format(plural(moreTaskCount, dict.moreTasks), { count: moreTaskCount })
            : dict.viewTasks}
        </Link>

        <ul className="flex flex-col gap-1 border-t pt-3">
          <li>
            <Link href="/dashboard/meal-planning" className={FACT_ROW}>
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground">{dict.tonight}</span>{" "}
                <span className="break-words font-medium">{tonightText ?? dict.nothingPlanned}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
          {safeToSpend && (
            <li>
              <Link href="/dashboard/budget" className={FACT_ROW}>
                <Wallet className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="text-muted-foreground">{dict.safeToSpend}</span>{" "}
                  <span className={`font-medium tabular-nums ${STATUS_COLOR[safeToSpend.status]}`}>
                    {safeToSpend.formatted}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          )}
          {expiringCount > 0 && (
            <li>
              <Link href="/dashboard/inventory" className={FACT_ROW}>
                <Snowflake className="size-4 shrink-0 text-warning" />
                <span className="min-w-0 flex-1 font-medium">
                  {format(plural(expiringCount, dict.expiring), { count: expiringCount })}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
