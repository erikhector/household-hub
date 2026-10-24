"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { navItems } from "@/components/dashboard/nav-items";
import {
  buildCommands,
  filterCommands,
  isPaletteShortcut,
  type PaletteCommand,
} from "@/components/dashboard/command-palette-commands";

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

function CommandIcon({ command }: { command: PaletteCommand }) {
  const Icon = command.kind === "action" ? Plus : navItems.find((item) => item.href === command.href)?.icon;
  return Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null;
}

export function CommandPalette({ dict, nav }: { dict: Dictionary["commandPalette"]; nav: Dictionary["nav"] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const commands = filterCommands(buildCommands(dict, nav), query);
  // Clamped on read, not reset in an effect: typing can shrink the list under
  // the highlight.
  const activeIndex = Math.min(active, Math.max(commands.length - 1, 0));

  const handleOpenChange = (next: boolean) => {
    // Every open starts blank, on the first command.
    if (next) {
      setQuery("");
      setActive(0);
    }
    setOpen(next);
  };
  // The shortcut listener is installed once, so it reads the latest handler
  // and state through a ref instead of re-subscribing on every keystroke.
  const toggleRef = useRef(() => {});
  useEffect(() => {
    toggleRef.current = () => handleOpenChange(!open);
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, commands.length]);

  const run = (command: PaletteCommand) => {
    setOpen(false);
    router.push(command.href);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (commands.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + commands.length) % commands.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = commands[activeIndex];
      if (command) run(command);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
            aria-activedescendant={commands.length > 0 ? `${listId}-${activeIndex}` : undefined}
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
          {commands.map((command, index) => (
            <li
              key={command.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => run(command)}
              onPointerMove={() => setActive(index)}
              className={cn(
                "flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm",
                index === activeIndex && "bg-accent text-accent-foreground",
              )}
            >
              <CommandIcon command={command} />
              <span className="min-w-0 truncate">{command.label}</span>
            </li>
          ))}
        </ul>
        {/* A live region, so a screen reader hears the count change as you
            type; it doubles as the empty state. */}
        <p role="status" className={cn("px-3 py-2 text-xs text-muted-foreground", commands.length > 0 && "sr-only")}>
          {commands.length === 0 ? dict.empty : format(plural(commands.length, dict.results), { count: commands.length })}
        </p>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground max-sm:hidden">{dict.hint}</p>
      </DialogContent>
    </Dialog>
  );
}
