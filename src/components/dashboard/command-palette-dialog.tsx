"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ListChecks, Package, Plus, Search, ShoppingCart, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { navItems } from "@/components/dashboard/nav-items";
import { buildCommands, filterCommands } from "@/components/dashboard/command-palette-commands";
import { searchHouseholdAction } from "@/lib/actions/search";
import { SEARCH_MIN_CHARS, type SearchGroup, type SearchGroupKey } from "@/lib/household-search";

// PERF-27: the palette's UI, split from the ⌘K listener in command-palette.tsx
// so the dialog (Base UI's drawer, the search action, the command list) is
// fetched on the first shortcut press (or in idle time before it), not with
// every dashboard page. That file owns `open`; this one is the dialog it
// asks for.
//
// UX-41a: ⌘K / Ctrl+K opens a command palette, mounted once in the
// dashboard layout. It's a keyboard shortcut for people at a desk, so there
// is no button for it. Never the only way to anything (DESIGN.md M7): every
// command is also a nav link or a page button. It stores nothing in the
// browser.
//
// Built on the shared Dialog so focus trap, Escape, outside press and the
// aria wiring match every other dialog. The input is a combobox over a
// listbox with aria-activedescendant: focus stays in the input while the
// arrow keys move the highlight, which is the pattern screen readers expect.
//
// UX-41b: once the query is long enough, a debounced search of the household
// (inventory, recipes, shopping lists, tasks, budget categories) adds grouped
// rows under the matching commands. Commands and hits share one flat list of
// options, so the arrow keys, Enter and the live count treat them alike.

type PaletteRow = {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType | undefined;
  /** The search group a hit belongs to; commands have none. Read out after
   * the label, since the visible heading is hidden from screen readers. */
  group?: string;
  /** Set on the first row of a group, where its visible heading goes. */
  heading?: boolean;
};

const GROUP_ICONS: Record<SearchGroupKey, React.ElementType> = {
  inventory: Package,
  recipes: CalendarDays,
  shoppingLists: ShoppingCart,
  tasks: ListChecks,
  budgetCategories: Wallet,
};

// How long typing must pause before a search goes out.
const SEARCH_DEBOUNCE_MS = 250;

// The groups for one query. Kept with the query they answer, so a slow reply
// for an older query is never shown under a newer one.
type Found = { query: string; groups: SearchGroup[]; rateLimited: boolean };

export function CommandPaletteDialog({
  dict,
  nav,
  open,
  onOpenChange,
}: {
  dict: Dictionary["commandPalette"];
  nav: Dictionary["nav"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<Found | null>(null);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const trimmed = query.trim();
  const commands = filterCommands(buildCommands(dict, nav), query);
  const current = found && found.query === trimmed ? found : null;

  const rows: PaletteRow[] = [
    ...commands.map((command) => ({
      id: command.id,
      label: command.label,
      href: command.href,
      icon: command.kind === "action" ? Plus : navItems.find((item) => item.href === command.href)?.icon,
    })),
    ...(current?.groups ?? []).flatMap((group) =>
      group.hits.map((hit, index) => ({
        id: `${group.key}-${hit.id}`,
        label: hit.name,
        href: hit.href,
        icon: GROUP_ICONS[group.key],
        group: dict.groups[group.key],
        heading: index === 0,
      })),
    ),
  ];
  // Clamped on read, not reset in an effect: typing can shrink the list under
  // the highlight.
  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));

  // Every open starts blank, on the first command. Adjusted during render
  // (the repo's "reset on open" pattern) because the owner flips `open`, so
  // there is no change handler of ours to put it in.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActive(0);
      setFound(null);
    }
  }

  // The debounced household search. The cleanup cancels a pending or
  // in-flight search when the query changes or the palette closes, so only
  // the latest query's answer lands.
  useEffect(() => {
    if (!open || trimmed.length < SEARCH_MIN_CHARS) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchHouseholdAction(trimmed)
        .then((result) => {
          if (cancelled) return;
          setFound(
            result.ok
              ? { query: trimmed, groups: result.groups, rateLimited: false }
              : { query: trimmed, groups: [], rateLimited: true },
          );
        })
        .catch(() => {
          // A failed search just leaves the commands, which still work.
          if (!cancelled) setFound({ query: trimmed, groups: [], rateLimited: false });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, trimmed]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, rows.length]);

  const run = (row: PaletteRow) => {
    onOpenChange(false);
    router.push(row.href);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[activeIndex];
      if (row) run(row);
    }
  };

  // While a long-enough query is still being searched, "no results" would be
  // premature, so the empty text waits for the answer.
  const searching = trimmed.length >= SEARCH_MIN_CHARS && !current;
  const statusText = current?.rateLimited
    ? dict.searchRateLimited
    : rows.length === 0
      ? searching
        ? ""
        : dict.empty
      : format(plural(rows.length, dict.results), { count: rows.length });
  const statusVisible = rows.length === 0 || Boolean(current?.rateLimited);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{dict.title}</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3 pr-12">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows.length > 0 ? `${listId}-${activeIndex}` : undefined}
            aria-label={dict.inputLabel}
            placeholder={dict.placeholder}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label={dict.listLabel} className="max-h-72 overflow-y-auto p-1">
          {rows.map((row, index) => {
            const Icon = row.icon;
            return (
              <li key={row.id} role="presentation">
                {row.heading ? (
                  <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground" aria-hidden="true">
                    {row.group}
                  </p>
                ) : null}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => run(row)}
                  onPointerMove={() => setActive(index)}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm",
                    index === activeIndex && "bg-accent text-accent-foreground",
                  )}
                >
                  {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
                  <span className="min-w-0 truncate">{row.label}</span>
                  {row.group ? <span className="sr-only">{row.group}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
        {/* A live region, so a screen reader hears the count change as you
            type; it doubles as the empty state. */}
        <p role="status" className={cn("px-3 py-2 text-xs text-muted-foreground", !statusVisible && "sr-only")}>
          {statusText}
        </p>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground max-sm:hidden">{dict.hint}</p>
      </DialogContent>
    </Dialog>
  );
}
