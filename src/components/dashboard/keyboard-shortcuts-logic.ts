// UX-41c: the pure parts of the single-key list shortcuts, kept apart from
// the component so a unit test can call them (there is no component-rendering
// setup here).

export type ShortcutAction = "new" | "search" | "next" | "previous" | "tick" | "help";

// The list pages the shortcuts belong to. Every key is ignored elsewhere, so
// a stray `n` on the budget page never does anything.
export const SHORTCUT_PATH_PREFIXES = ["/dashboard/shopping-list", "/dashboard/inventory", "/dashboard/tasks"];

export function isShortcutPath(pathname: string): boolean {
  return SHORTCUT_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Plain keys only: Ctrl/Cmd/Alt combinations belong to the browser and to the
// command palette (Ctrl+K). Shift is allowed only because `?` needs it.
export function shortcutFor(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): ShortcutAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "?") return "help";
  if (event.shiftKey) return null;
  switch (event.key) {
    case "n":
      return "new";
    case "/":
      return "search";
    case "j":
      return "next";
    case "k":
      return "previous";
    case "x":
      return "tick";
    default:
      return null;
  }
}

// True while the key is meant for a field (or a widget that reads keys
// itself), so typing "next" into the search box never moves the highlight.
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === "INPUT") {
    // A checkbox takes no text, and it is the focused control after a click on
    // a row, so `x` / `j` should still work from there.
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset"].includes(type);
  }
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

// Next/previous row without wrapping. With nothing highlighted yet, either key
// lands on the first row, so the first press always shows where you are.
export function moveIndex(current: number, count: number, direction: "next" | "previous"): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return 0;
  return direction === "next" ? Math.min(current + 1, count - 1) : Math.max(current - 1, 0);
}
