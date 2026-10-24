import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { navItems } from "@/components/dashboard/nav-items";

// UX-41a: the command palette's static commands. Kept apart from the
// component so the list and the filter are plain functions a unit test can
// call (there is no component-rendering setup here).

export type PaletteCommand = {
  id: string;
  label: string;
  href: string;
  /** Which kind of command it is, for the icon and the group. */
  kind: "goTo" | "action";
};

// The "Add …" actions land on the page with `?add=1`, which the page's own
// add control reads (TaskFormDialog opens, SmartAddBar takes focus) and then
// strips. The palette itself holds no dialog, so it stays one small module
// and the add forms stay where they already are.
export const ADD_PARAM = "add";

export function buildCommands(dict: Dictionary["commandPalette"], nav: Dictionary["nav"]): PaletteCommand[] {
  const goTo = navItems.map<PaletteCommand>((item) => ({
    id: `go-${item.key}`,
    label: format(dict.goTo, { section: nav[item.key] }),
    href: item.href,
    kind: "goTo",
  }));
  const actions: PaletteCommand[] = [
    { id: "add-task", label: dict.addTask, href: `/dashboard/tasks?${ADD_PARAM}=1`, kind: "action" },
    {
      id: "add-shopping",
      label: dict.addToShoppingList,
      href: `/dashboard/shopping-list?${ADD_PARAM}=1`,
      kind: "action",
    },
  ];
  // Quick actions first: they are what a keyboard user reaches for most.
  return [...actions, ...goTo];
}

// Every whitespace-separated word of the query must appear somewhere in the
// label, so "go bud" finds "Go to Household budget" and word order is free.
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  return commands.filter((command) => {
    const label = command.label.toLocaleLowerCase();
    return words.every((word) => label.includes(word));
  });
}

// ⌘K on macOS, Ctrl+K elsewhere. Alt/Shift variants are left to the browser.
export function isPaletteShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) {
  return (
    event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
  );
}
